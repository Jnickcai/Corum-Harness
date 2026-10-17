#!/usr/bin/env node
/**
 * 全量编译 —— 一条命令把「打包前必须全部就绪」的东西一次做完。
 *
 * ## 为什么需要它（2026-10-17 的血债）
 *
 * 打包（`pack:host`）会断言每个 client 插件都过了**完整**构建（`lib/client.js`
 * 存在且 CSS 已内联）。但它只管断言，不管补做。于是只要有一个包没构建过，
 * 打包就在最后一步失败，且报错只指向「缺失」而不指向「顺序」：
 *
 *   ✗ @corum/corum-web-search：lib/client.js 缺失
 *   ✗ @corum/corum-issue-reporter-ui：lib/client.js 缺失
 *
 * 这次的真实根因有两层，手工修很容易只修到第一层：
 *
 * 1. **包从未构建过** —— 新 PR 合入的插件在本地没有 `lib/`。
 * 2. **依赖产物过时** —— `corum-web-search` 依赖 `corum-ui-base` 的
 *    `webSearchCredentialRef`，而 ui-base 的 `lib/` 还是旧版 ⇒ 即便补建了
 *    web-search，`tsc` 仍报 `has no exported member`。**必须先建 ui-base。**
 *
 * 所以脚本的三条硬性要求：
 *
 * - **按依赖拓扑序构建**（`pnpm -r` 默认就是拓扑序，`--parallel` 才会破坏它）。
 *   这直接消灭第 2 层问题，不需要人工判断谁先谁后。
 * - **每个包都走完整三步**（`tsc -b && tsdown && inline-css`），因为 CSS 内联
 *   是打包断言的判据，只跑 tsc 不够。
 * - **失败即停并指名道姓**，不留下「一半构建好」的中间态让人误判。
 *
 * ## 用法
 *
 *   node scripts/build-all.mjs              # 全量：所有包
 *   node scripts/build-all.mjs --changed     # 只建自上次打包后有改动的包（含依赖者）
 *   node scripts/build-all.mjs --verify      # 只做就绪断言，不构建（给 CI/打包前用）
 *
 * @module scripts/build-all
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS_DIR = join(ROOT, 'packages', 'plugins')

/** 目标平台常量：打包链路依赖它把 `__CORUM_TARGET_PLATFORM__` 烘进 Electron 壳。 */
function targetPlatform() {
  const arg = process.argv.find(a => a.startsWith('--platform='))
  if (arg !== undefined) return arg.slice('--platform='.length)
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--platform' && process.argv[i + 1] !== undefined) return process.argv[i + 1]
  }
  return process.env.CORUM_TARGET_PLATFORM ?? process.platform
}

const PLATFORM = targetPlatform()
const VERIFY_ONLY = process.argv.includes('--verify')
const CHANGED_ONLY = process.argv.includes('--changed')

/** 人类可读的一行日志（不加时间戳，CI 日志里由 runner 提供）。 */
function log(message) {
  process.stdout.write(`${message}\n`)
}

/** 一个 workspace 包的最小事实集。 */
function readPackages() {
  const out = []
  const groups = ['ui', 'session', 'agent']
  for (const group of groups) {
    const dir = join(PLUGINS_DIR, group)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const pkgDir = join(dir, name)
      const manifest = join(pkgDir, 'package.json')
      if (!existsSync(manifest)) continue
      let pkg
      try { pkg = JSON.parse(readFileSync(manifest, 'utf8')) } catch { continue }
      out.push({
        dir: pkgDir,
        name: pkg.name ?? name,
        rel: relative(ROOT, pkgDir),
        scripts: pkg.scripts ?? {},
        deps: { ...pkg.dependencies, ...pkg.devDependencies },
        /** client 插件必须产出 lib/client.js（打包断言判据）。 */
        isClient: pkg.dsh?.client !== undefined,
      })
    }
  }
  return out
}

/** 由一个包的依赖里，挑出同 workspace 的兄弟包（决定构建顺序）。 */
function workspaceDepsOf(pkg, byName) {
  const out = []
  for (const [dep, spec] of Object.entries(pkg.deps ?? {})) {
    if (!String(spec).startsWith('workspace:') && !String(spec).startsWith('link:')) continue
    const found = byName.get(dep)
    if (found !== undefined) out.push(found)
  }
  return out
}

/**
 * 拓扑排序（依赖在前）。
 *
 * 不用 `pnpm -r run build` 一把梭是因为：这里还要做**自定义的失败归因**与
 * **变更集裁剪**，而 pnpm 的递归输出在多包并行时很难对应到具体包。排序逻辑很
 * 短，自己持有比解析别人的日志更可靠。
 */
function topoSort(packages) {
  const byName = new Map(packages.map(p => [p.name, p]))
  const order = []
  const state = new Map() // name -> 'visiting' | 'done'
  const visit = (pkg, chain) => {
    const s = state.get(pkg.name)
    if (s === 'done') return
    if (s === 'visiting') {
      throw new Error(`依赖成环：${[...chain, pkg.name].join(' → ')}`)
    }
    state.set(pkg.name, 'visiting')
    for (const dep of workspaceDepsOf(pkg, byName)) visit(dep, [...chain, pkg.name])
    state.set(pkg.name, 'done')
    order.push(pkg)
  }
  for (const pkg of packages) visit(pkg, [])
  return order
}

/** 自 `since` 起改动过的路径集合（git 相对仓库根的路径）。 */
function changedPaths(since) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', since, '--'], { cwd: ROOT, encoding: 'utf8' })
    return new Set(out.split('\n').filter(Boolean))
  } catch {
    return null
  }
}

/** 一个包是否在改动集里（任一文件路径以该包目录开头）。 */
function isTouched(pkg, paths) {
  if (paths === null) return true
  const prefix = `${pkg.rel}/`
  for (const p of paths) if (p.startsWith(prefix)) return true
  return false
}

/**
 * 构建后的就绪断言，与打包脚本同一口径。
 * @returns 未就绪的包清单（空数组 = 全就绪）。
 */
function notReady(packages) {
  const bad = []
  for (const pkg of packages) {
    if (!pkg.isClient) continue
    const clientJs = join(pkg.dir, 'lib', 'client.js')
    if (!existsSync(clientJs)) { bad.push({ pkg, why: 'lib/client.js 缺失' }); continue }
    // CSS 必须已内联：打包断言看的就是这条（外置 style.css 的开发运行时是 404）。
    const styleCss = join(pkg.dir, 'lib', 'style.css')
    if (existsSync(styleCss)) {
      bad.push({ pkg, why: 'lib/style.css 仍外置（inline-css 未跑）' })
      continue
    }
    const size = statSync(clientJs).size
    if (size < 1024) bad.push({ pkg, why: `lib/client.js 过小（${size} bytes，疑似未真正构建）` })
  }
  return bad
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

const packages = readPackages()
const byName = new Map(packages.map(p => [p.name, p]))

if (VERIFY_ONLY) {
  const bad = notReady(packages)
  if (bad.length === 0) {
    log(`✓ 全部 ${packages.filter(p => p.isClient).length} 个 client 插件已就绪`)
    process.exit(0)
  }
  log(`✗ ${bad.length} 个 client 插件未就绪：`)
  for (const { pkg, why } of bad) log(`    ${pkg.name}  (${why})`)
  log('  修复：node scripts/build-all.mjs')
  process.exit(1)
}

// 变更集：从上次打包产物推算，或退回「与 origin/main 比」。
let touched = null
if (CHANGED_ONLY) {
  const base = process.env.CORUM_BUILD_SINCE ?? 'origin/main'
  touched = changedPaths(base)
  if (touched === null) log(`⚠ 无法取得改动集（git diff ${base} 失败），退回全量`)
  else log(`→ 只构建自 ${base} 起有改动的包（${touched.size} 个文件）`)
}

// 被改动的包 + 所有依赖它们的包（下游必须重建：上游产物变了）。
const targets = new Set()
if (touched !== null) {
  for (const pkg of packages) if (isTouched(pkg, touched)) targets.add(pkg)
  let grew = true
  while (grew) {
    grew = false
    for (const pkg of packages) {
      if (targets.has(pkg)) continue
      if (workspaceDepsOf(pkg, byName).some(d => targets.has(d))) { targets.add(pkg); grew = true }
    }
  }
}

// targets 为空有两种含义，必须区分：
//   - 没开启 --changed：全量构建
//   - 开启了但没有任何包被改动：什么都不建（而不是误当全量）
const plan = topoSort(packages).filter(p => (touched === null ? true : targets.has(p)))

log(`→ 目标平台 ${PLATFORM}；待构建 ${plan.length} / ${packages.length} 个 workspace 包`)

const failed = []
const skipped = []
for (const [i, pkg] of plan.entries()) {
  const tag = `[${String(i + 1).padStart(2)}/${plan.length}]`
  const build = pkg.scripts.build
  if (build === undefined) { skipped.push(pkg); continue }
  // 平台常量只对 Electron 壳有意义；对插件无害，统一注入可避免「某些包忘记」。
  const env = { ...process.env, CORUM_TARGET_PLATFORM: PLATFORM }
  log(`${tag} ${pkg.name}`)
  try {
    execFileSync('npm', ['run', 'build', '--silent'], {
      cwd: pkg.dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
  } catch (error) {
    failed.push({ pkg, output: `${error.stdout ?? ''}${error.stderr ?? ''}` })
  }
}

if (skipped.length > 0) log(`\n（跳过 ${skipped.length} 个无 build 脚本的包）`)

if (failed.length > 0) {
  log(`\n✗ ${failed.length} 个包构建失败：`)
  for (const { pkg, output } of failed) {
    log(`\n── ${pkg.name} ──`)
    // 只留前 25 行：通常是 tsc 的第一条真错，后面的都是它的连带。
    log(output.trim().split('\n').slice(0, 25).map(l => `  ${l}`).join('\n'))
  }
  process.exit(1)
}

// 构建完再断言一遍就绪：形状不对就当场失败，不留给打包去发现。
const bad = notReady(packages)
if (bad.length > 0) {
  log(`\n✗ 构建完成但 ${bad.length} 个 client 插件仍未就绪：`)
  for (const { pkg, why } of bad) log(`    ${pkg.name}  (${why})`)
  process.exit(1)
}

if (plan.length === 0) {
  log(`\n✓ 没有包需要重建（改动不在任何包目录内）；${packages.filter(p => p.isClient).length} 个 client 插件仍就绪`)
} else {
  log(`\n✓ 编译完成：${plan.length} 个包，${packages.filter(p => p.isClient).length} 个 client 插件就绪`)
}
log('  下一步：npm run pack:host:mac （或 ./scripts/corum-instance.sh update --mode=packaged）')
