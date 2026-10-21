#!/usr/bin/env node
/**
 * repair-session-unknown-events.mjs —— 修复「被未知事件类型毒化的会话日志」。
 *
 * ## 它解决什么问题（2026-10-21 实测事故）
 *
 * 会话持久化在**读**路径上有一条硬拒绝（官方 `@deepseek-ai/dsh-session` 的
 * `validateStoredEvents`）：日志里出现**本 build 不认识的 required 事件类型**时，
 * 它不会猜测，而是整条会话拒绝加载：
 *
 *   failed to observe session "…": session "…" contains event type
 *   "corum/foreground-busy" (seq 49) unknown to this harness and not marked
 *   ignorable; refusing to interpret the log
 *
 * 本次真因：`issue #75` 的伪前台特性**被整组 revert**（`68a23482`…`d911e4e6`），
 * 但它在 revert 之前写进会话的 `corum/foreground-busy` 事件**留在日志里**，且
 * **没有 `ignorable` 标记**。于是退版后的 harness 认为这是「更新的 harness 写的
 * 日志」，把 8 条会话全部拒读。
 *
 * 官方的兼容机制只有一条（见 `SessionEvent.ignorable` 的契约）：事件写入方用
 * `ignorable: true` 标记「丢掉它不影响重建」。所以正确的修法是把这些事件补上
 * 该标记——**不是**删事件、**不是**改类型。
 *
 * ## 关键：必须保留 zstd 分帧结构
 *
 * 日志不是「一段 zstd」，而是**逐帧追加**的：**第一帧必须恰好是那一条 header 行**
 * （`assertFirstFrameHeader`），之后的帧装事件行。把整个文件解码后压成一个流
 * （任何朴素的 `zstd -d | zstd -3`）会立刻失败：
 *
 *   corrupt Zstandard session log: first frame is not exactly one header line
 *
 * 本脚本因此按「header 一帧 + 其余事件一帧」重写：读者按帧顺序解码，能正常重建。
 *
 * ## 用法
 *
 *   node scripts/repair-session-unknown-events.mjs --type=corum/foreground-busy --dry-run
 *   node scripts/repair-session-unknown-events.mjs --type=corum/foreground-busy
 *   node scripts/repair-session-unknown-events.mjs --type=<name> --home=/abs/corum-home
 *
 * 退出码：0 = 无需修复或已修复；1 = 有文件修复失败（原文件未被破坏）。
 *
 * ⚠️ **先退出应用再跑**：运行中的 host 会追加日志，重写文件期间的新事件会落到
 * 被替换掉的旧 inode 上而丢失（写是原子 replace）。脚本会在检测到日志仍在增长时
 * 拒绝该文件并提示。
 *
 * @module repair-session-unknown-events
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (hit === undefined) return undefined
  if (hit === `--${name}`) return true
  return hit.slice(name.length + 3)
}

const TYPES = String(flag('type') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
if (TYPES.length === 0) {
  process.stderr.write('[repair] 必须用 --type=<事件类型> 指定要标记为 ignorable 的类型（可逗号分隔多个）\n')
  process.exit(2)
}
const DRY = flag('dry-run') === true
const HOME = resolve(String(flag('home') ?? join(homedir(), '.corum')))
const SESSIONS = join(HOME, 'sessions')

function fail(message) {
  process.stderr.write(`[repair] FATAL: ${message}\n`)
  process.exit(1)
}

function zstdAvailable() {
  try {
    execFileSync('zstd', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!zstdAvailable()) fail('找不到 zstd 可执行文件（macOS: brew install zstd；Linux: apt install zstd）')
if (!existsSync(SESSIONS)) fail(`找不到会话目录：${SESSIONS}`)

/** 逐帧解压后的纯文本（zstd CLI 会按顺序解码拼接的帧）。 */
function decompress(path) {
  return execFileSync('zstd', ['-d', '-c', path], { maxBuffer: 1 << 30 })
}

/** 压缩为单个帧。 */
function compress(buffer) {
  return execFileSync('zstd', ['-q', '-3', '-c'], { input: buffer, maxBuffer: 1 << 30 })
}

/** 递归找出所有 session 日志。 */
function* logs(root) {
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const projectDir = join(root, project.name)
    for (const session of readdirSync(projectDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const sessionDir = join(projectDir, session.name)
      for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        if (!/^session\.v\d+\.jsonl(?:\.zstd)?$/.test(entry.name)) continue
        yield join(sessionDir, entry.name)
      }
    }
  }
}

let repaired = 0
let skipped = 0
let failed = 0
const stamp = new Date().toISOString().replace(/[:.]/g, '-')

for (const path of logs(SESSIONS)) {
  const compressed = path.endsWith('.zstd')
  const plaintext = decompress(path).toString('utf8')
  const lines = plaintext.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) continue

  const header = lines[0]
  const events = lines.slice(1)
  let changed = 0
  const rewritten = events.map((line) => {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      return line // 损坏行原样保留（不是本脚本的职责）
    }
    if (!TYPES.includes(parsed.type) || parsed.ignorable === true) return line
    changed += 1
    parsed.ignorable = true
    return JSON.stringify(parsed)
  })

  if (changed === 0) continue

  if (DRY) {
    process.stdout.write(`[repair] would mark ${changed} event(s) in ${path}\n`)
    repaired += 1
    continue
  }

  // 增长检测：运行中的 host 会追加日志；重写会让它落到旧 inode 上。
  const before = statSync(path).size
  await new Promise((r) => setTimeout(r, 250))
  if (statSync(path).size !== before) {
    process.stderr.write(`[repair] 跳过（日志仍在增长，退出应用后重跑）：${path}\n`)
    skipped += 1
    continue
  }

  // header 一帧 + 事件一帧：这是读者要求的形态，别合并成一个流。
  const blob = Buffer.concat([
    compress(Buffer.from(`${header}\n`, 'utf8')),
    compress(Buffer.from(`${rewritten.join('\n')}\n`, 'utf8')),
  ])

  const backup = `${path}.bak-${stamp}`
  const tmp = `${path}.tmp`
  try {
    copyFileSync(path, backup)
    if (compressed) writeFileSync(tmp, blob)
    else writeFileSync(tmp, Buffer.from(`${header}\n${rewritten.join('\n')}\n`, 'utf8'))
    renameSync(tmp, path)
    repaired += 1
    process.stdout.write(`[repair] ${changed} event(s) marked ignorable → ${path}\n`)
  } catch (error) {
    failed += 1
    process.stderr.write(`[repair] 失败（原文件未动，备份在 ${backup}）：${path}: ${String(error)}\n`)
  }
}

process.stdout.write(`[repair] 完成：修复 ${repaired} 个日志，跳过 ${skipped} 个，失败 ${failed} 个（home=${HOME}）\n`)
if (failed > 0) process.exit(1)
