#!/usr/bin/env node
/**
 * publish.mjs —— `@corum/*` 插件包的发布流水线（方案 §A.5 / P5）。
 *
 * ## 它解决什么
 *
 * 48 个插件包要发到 npm，但发布顺序**不能靠人记**：`plugin-sdk` 必须在它 re-export 的
 * `ui-base` / `rpc-client` 之后，`plugin-build` 在被任何包当构建依赖之前。顺序错了
 * 表现为「装到一半 404」，而修它要重发。
 *
 * ## 四道关（顺序即失败代价）
 *
 * 1. **规范守卫**（`verify-plugin-spec.mjs --strict`）—— 不过就不发。
 * 2. **拓扑排序** —— 只算**运行时** `dependencies` 里的 `@corum/*` 边（dev/peer 不参与，
 *    否则会引入假约束；与方案 §A.5 的口径一致）。
 * 3. **幂等** —— 已存在的 `name@version` 跳过（不报错），所以重跑安全。
 * 4. **失败即停** —— 已发布的记进台账，不继续往后发（避免半套版本）。
 *
 * ## 用法
 *
 *   node scripts/publish.mjs                    # 干跑（默认）：列包 + 拓扑序 + 已发布判定
 *   node scripts/publish.mjs --layer=public      # 只干跑公开层
 *   node scripts/publish.mjs --publish --layer=public   # 真发
 *   node scripts/publish.mjs --publish --layer=all
 *
 * **默认是干跑**：真发必须显式 `--publish`（发布不可逆，不该由「忘了加 --dry-run」触发）。
 *
 * ## 公开层 / 内部层
 *
 * 公开层 = 第三方写插件真正需要的面（方案 §A.2）。内部层 = 其余 43 个包：发布但不承诺
 * API 稳定，文档标注 internal。**`corum-tools` / `corum-fs-local` 不发**（它们顶替官方
 * `@deepseek-ai/dsh-tools` / `dsh-fs-local`，发出去会让第三方装到两个包，方案 §F.1）。
 *
 * @module scripts/publish
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const LEDGER = join(ROOT, 'docs', 'RELEASE-LEDGER.md')
const args = new Set(process.argv.slice(2))
const argValue = (name, fallback) => {
  const inline = process.argv.find(a => a.startsWith(`--${name}=`))
  return inline === undefined ? fallback : inline.slice(name.length + 3)
}
const DO_PUBLISH = args.has('--publish')
const LAYER = argValue('layer', 'public')

/** 公开层：第三方插件开发真正需要的面（方案 §A.2）。 */
const PUBLIC_LAYER = new Set([
  '@corum/plugin-sdk',
  '@corum/plugin-build',
  '@corum/corum-ui-base',
  '@corum/corum-rpc-client',
  '@corum/corum-platform',
])

/** 永不发布：顶替官方包名的 fork（发出去会让第三方装到两个包，方案 §F.1）、测试占位、构建工具已单列。 */
const NEVER_PUBLISH = new Set([
  '@corum/corum-tools',
  '@corum/corum-fs-local',
  '@corum/corum-ide-test-conversation-ui',
  '@corum/corum-ide-test-sidebar-ui',
  '@corum/corum-ide-test-statusbar-ui',
])

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function run(command, commandArgs, cwd) {
  return execFileSync(command, commandArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function pnpmBin() {
  for (const candidate of ['/opt/homebrew/bin/pnpm', '/usr/local/bin/pnpm']) {
    if (existsSync(candidate)) return candidate
  }
  return 'pnpm'
}

/** 工作区里的全部可发布包（插件 + tooling + sdk）。 */
function collectPackages() {
  const packages = []
  const roots = [
    join(ROOT, 'packages', 'plugins'),
    join(ROOT, 'packages', 'tooling'),
    join(ROOT, 'packages', 'sdk'),
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    const groups = root.endsWith('plugins') ? readdirSync(root).map(g => join(root, g)) : [root]
    for (const group of groups) {
      for (const name of readdirSync(group)) {
        const dir = join(group, name)
        const manifestPath = join(dir, 'package.json')
        if (!existsSync(manifestPath)) continue
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (NEVER_PUBLISH.has(manifest.name)) continue
        if (manifest.private === true) continue
        packages.push({ dir, manifest })
      }
    }
  }
  return packages
}

/**
 * 拓扑排序：只算运行时 `dependencies` 里的 `@corum/*` 边。
 * @returns 依赖在前的顺序（同层按名字稳定排序，便于 diff）。
 */
function topologicalOrder(packages) {
  const byName = new Map(packages.map(p => [p.manifest.name, p]))
  const order = []
  const visiting = new Set()
  const visited = new Set()
  const visit = (name) => {
    if (visited.has(name)) return
    if (visiting.has(name)) throw new Error(`依赖成环：${[...visiting].join(' → ')} → ${name}`)
    visiting.add(name)
    const pkg = byName.get(name)
    for (const dep of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (byName.has(dep)) visit(dep)
    }
    visiting.delete(name)
    visited.add(name)
    order.push(pkg)
  }
  for (const name of [...byName.keys()].sort()) visit(name)
  return order
}

/**
 * 该版本是否已在 registry 上。
 *
 * 为什么直连 registry 而不用 `npm view`：npm CLI 在 Agent 沙箱里会尝试写 `~/.npm`
 * （cache/logs）并直接失败 —— 实测 `npm error sudo chown -R ... /Users/…/.npm`。
 * 发布判定不该被「本机 npm 缓存目录权限」左右。
 * @returns true / false / undefined（网络不可达 = 未知，不阻断干跑）
 */
async function publishedVersion(manifest) {
  const url = `https://registry.npmjs.org/${manifest.name.replace('/', '%2f')}`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (response.status === 404) return false
    if (!response.ok) return undefined
    const body = await response.json()
    return body.versions?.[manifest.version] !== undefined
  } catch {
    return undefined
  }
}

// ── 关 1：规范守卫 ──────────────────────────────────────────────────────
console.log('── 1. 规范守卫（--strict）')
try {
  run(process.execPath, [join(ROOT, 'scripts', 'verify-plugin-spec.mjs'), '--strict'], ROOT)
  console.log('  ✓ error 0 / warn 0')
} catch (error) {
  fail(`规范守卫未通过，拒绝发布：\n${error.stdout ?? ''}${error.stderr ?? ''}`)
}

// ── 关 2：选层 + 拓扑序 ─────────────────────────────────────────────────
const all = collectPackages()
const selected = LAYER === 'all'
  ? all
  : all.filter(p => PUBLIC_LAYER.has(p.manifest.name))
if (selected.length === 0) fail(`layer=${LAYER} 没有选中任何包`)
const ordered = topologicalOrder(selected)

console.log(`\n── 2. 发布顺序（layer=${LAYER}，${ordered.length} 个包，运行时依赖口径）`)
for (const [index, pkg] of ordered.entries()) {
  const layer = PUBLIC_LAYER.has(pkg.manifest.name) ? 'public' : 'internal'
  console.log(`  ${String(index + 1).padStart(2)}. ${pkg.manifest.name}@${pkg.manifest.version}  [${layer}]`)
}

// ── 关 3：幂等判定 ──────────────────────────────────────────────────────
console.log('\n── 3. 已发布判定')
const todo = []
for (const pkg of ordered) {
  const exists = await publishedVersion(pkg.manifest)
  const label = exists === true ? '已存在，跳过' : exists === false ? '待发布' : '未知（registry 不可达）'
  console.log(`  · ${pkg.manifest.name}@${pkg.manifest.version} → ${label}`)
  if (exists !== true) todo.push(pkg)
}

if (!DO_PUBLISH) {
  console.log(`\n干跑完成：${todo.length} 个包待发布。真发请加 --publish（不可逆）。`)
  process.exit(0)
}

// ── 关 4：逐包发布，失败即停 ────────────────────────────────────────────
console.log(`\n── 4. 发布（${todo.length} 个包）`)
const done = []
for (const pkg of todo) {
  process.stdout.write(`  → ${pkg.manifest.name}@${pkg.manifest.version} … `)
  try {
    run(pnpmBin(), ['publish', '--access', 'public', '--no-git-checks'], pkg.dir)
    console.log('ok')
    done.push(pkg.manifest)
  } catch (error) {
    console.log('FAILED')
    appendLedger(done, `中断于 ${pkg.manifest.name}@${pkg.manifest.version}：${(error.stderr ?? error.message).split('\n')[0]}`)
    fail(`发布失败并已停止（已发 ${done.length} 个，记录在 ${LEDGER}）`)
  }
}
appendLedger(done, '全部成功')
console.log(`\n✓ 发布完成：${done.length} 个包`)

/** 台账一行一个包（应用版 ↔ 基座版映射的唯一事实源是 docs/VERSIONING.md，这里只记 npm 发布事实）。 */
function appendLedger(published, note) {
  const header = existsSync(LEDGER) ? '' : '# 发布台账（npm `@corum/*`）\n\n| 时间 | 包 | 版本 | 结果 |\n|---|---|---|---|\n'
  const stamp = new Date().toISOString()
  const rows = published.map(p => `| ${stamp} | \`${p.name}\` | ${p.version} | ok |`).join('\n')
  const line = `${rows}\n\n> ${stamp} ${note}\n`
  try {
    writeFileSync(LEDGER, `${existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : ''}${header}${line}`)
  } catch (error) {
    console.error(`（台账写入失败，忽略）${String(error)}`)
  }
}
