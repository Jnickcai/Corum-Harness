#!/usr/bin/env node
/**
 * verify-plugin-install-e2e.mjs —— 「第三方插件真的装得进去、真的挂得上」的端到端判据
 * （方案 §E 验收判据 2）。
 *
 * ## 为什么需要它（纯单测证明不了这件事）
 *
 * 一个插件能 `build` 出闭包、能在 workspace 里被 import，都**不等于**它能被装进 profile
 * 并被 loader 挂载：中间还隔着 tarball 里的产物、profile 的 node_modules 解析、
 * `dsh.profile.bundles` 的叠层、`/plugins/` 端点的静态供应。只有真装一次才知道。
 *
 * ## 它做的事（对**已运行**的实例操作，装完还原）
 *
 * 1. `pnpm pack` 样例插件 + 它的 SDK 依赖（registry 上还没发布 0.6.0，用 overrides 指本地 tgz）
 * 2. 把 tgz 装进 profile（与插件中心同一条 `pnpm add` 路径）
 * 3. 把包名加进 `dsh.profile.bundles`，让宿主的预检层装载它
 * 4. **断言宿主半**：`pluginManager/list` 里出现该包且 `fiberPhase === 'active'`
 * 5. **断言客户端半**：`window.__DSH_BOOT__.entries` 里有它的 client URL，且该 URL 200
 *    （⚠️ 必须带 `rev` 参数 —— 不带一律 404，本脚本 2026-10-21 实测踩过）
 * 6. **还原**：manifest / workspace 文件写回、卸载包
 *
 * ## 用法（实例需先起来）
 *
 *   ./scripts/corum-instance.sh start --home=.corum-verify-home --port=9334 --allow-sandboxed
 *   CDP_PORT=9334 node scripts/verify-plugin-install-e2e.mjs --home=/abs/path/.corum-verify-home
 *   ./scripts/corum-instance.sh stop  --home=.corum-verify-home --port=9334
 *
 * ⚠️ 第 3 步改了 profile 的 bundles，**重启后**才会装载 —— 所以本脚本默认假设实例
 * 已经加载过该插件；若尚未加载，它会打印「请重启实例后再跑」并退出 2。
 *
 * @module scripts/verify-plugin-install-e2e
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const args = new Set(process.argv.slice(2))
const argValue = (name, fallback) => {
  const inline = process.argv.find(a => a.startsWith(`--${name}=`))
  return inline === undefined ? fallback : inline.slice(name.length + 3)
}
const HOME = resolve(argValue('home', join(ROOT, '.corum-verify-home')))
const PORT = argValue('port', process.env.CDP_PORT ?? '9333')
const RESTART = args.has('--restart')
const PLUGIN = '@corum-examples/hello-plugin'
const PROFILE = process.env.CORUM_DESKTOP_PROFILE ?? 'web'
const PROFILE_DIR = join(HOME, 'profiles', PROFILE)
const MANIFEST = join(PROFILE_DIR, 'package.json')
const WORKSPACE = join(PROFILE_DIR, 'pnpm-workspace.yaml')

const PACKS = []
const failures = []
const ok = message => console.log(`  ✓ ${message}`)
const fail = message => { failures.push(message); console.log(`  ✗ ${message}`) }
const skip = message => console.log(`  … SKIP ${message}`)

function run(command, commandArgs, cwd) {
  return execFileSync(command, commandArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function pnpmBin() {
  for (const candidate of ['/opt/homebrew/bin/pnpm', '/usr/local/bin/pnpm']) if (existsSync(candidate)) return candidate
  return 'pnpm'
}
/** 在**页面上下文**里执行（同源 fetch + 读 window），复刻 cdp.mjs 的连接方式。 */
function cdpEval(expression) {
  // cdp.mjs 把页面返回值 JSON.stringify 一次再打印；而我们的表达式本身返回的是 JSON
  // 字符串（为了跨进程只传一层），所以这里要解两层。
  const raw = run(process.execPath, [join(ROOT, 'scripts', 'cdp.mjs'), 'eval', expression], ROOT)
  const first = JSON.parse(raw)
  return typeof first === 'string' ? JSON.parse(first) : first
}

/**
 * 等页面真正就绪：CDP 端口开放 ≠ 页面加载完（重启后尤其）。刷新前后都要过这一关，
 * 否则页面里的 fetch 会抛 `TypeError: Failed to fetch`（实测）。
 */
async function waitForPageReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const ready = cdpEval(`JSON.stringify(
        location.protocol.startsWith('http') && document.readyState === 'complete'
          && (window.__DSH_BOOT__?.entries?.length ?? 0) > 0
      )`)
      if (ready === true) return true
    } catch { /* target 还没就绪 */ }
    await new Promise(r => setTimeout(r, 1500))
  }
  return false
}

if (!existsSync(MANIFEST)) {
  console.error(`✗ profile 不存在：${MANIFEST}（先用 --home 指到一个真实的 corum home）`)
  process.exit(2)
}

const manifestBefore = readFileSync(MANIFEST, 'utf8')
const workspaceBefore = existsSync(WORKSPACE) ? readFileSync(WORKSPACE, 'utf8') : undefined
const work = mkdtempSync(join(tmpdir(), 'corum-install-e2e-'))

function restore() {
  try {
    writeFileSync(MANIFEST, manifestBefore)
    if (workspaceBefore !== undefined) writeFileSync(WORKSPACE, workspaceBefore)
    run(pnpmBin(), ['install', '--prefer-offline'], PROFILE_DIR)
    rmSync(work, { recursive: true, force: true })
  } catch (error) {
    console.error(`（还原失败，请手工检查 ${PROFILE_DIR}）${String(error)}`)
  }
}

try {
  console.log(`── 0. 环境：home=${HOME} port=${PORT} profile=${PROFILE}`)

  // ── 1. 打包 ────────────────────────────────────────────────────────────
  console.log('── 1. pnpm pack（插件 + 它的 SDK 依赖）')
  for (const rel of ['packages/sdk/corum-plugin-sdk', 'packages/plugins/ui/corum-ui-base', 'packages/plugins/ui/corum-rpc-client', 'examples/hello-plugin']) {
    const out = run(pnpmBin(), ['pack', '--pack-destination', work], join(ROOT, rel))
    const tgz = out.split('\n').map(l => l.trim()).filter(l => l.endsWith('.tgz')).pop()
    if (tgz === undefined) { fail(`${rel}: pack 没有产出 tgz`); throw new Error('pack failed') }
    PACKS.push({ rel, tgz })
  }
  ok(`${PACKS.length} 个 tarball 已打出`)

  // ── 2. 装进 profile（与插件中心同一条 pnpm add 路径） ───────────────────
  console.log('── 2. 装进 profile')
  const pluginTgz = PACKS.find(p => p.rel === 'examples/hello-plugin').tgz
  const override = name => {
    const hit = PACKS.find(p => JSON.parse(readFileSync(join(ROOT, p.rel, 'package.json'), 'utf8')).name === name)
    return hit === undefined ? undefined : `file:${hit.tgz}`
  }
  const overrides = ['@corum/plugin-sdk', '@corum/corum-ui-base', '@corum/corum-rpc-client']
    .map(name => [name, override(name)])
    .filter(([, tgz]) => tgz !== undefined)
  // profile 里可能已有 overrides（上一次跑留下的或用户自己写的）：先剥掉再写，
  // 重复的 `overrides:` 键会让 pnpm 直接报 duplicated mapping key。
  const baseWorkspace = (workspaceBefore ?? 'packages:\n  - .\n')
    .replace(/\n# E2E（verify-plugin-install-e2e\.mjs）[\s\S]*$/, '')
    .replace(/\n{2,}overrides:[\s\S]*$/, '')
    .replace(/\noverrides:[\s\S]*$/, '')
  writeFileSync(WORKSPACE, `${baseWorkspace.replace(/\s+$/, '')}\n\n# E2E（verify-plugin-install-e2e.mjs）：未发布的 @corum 包指向本地 tarball\noverrides:\n${overrides.map(([n, t]) => `  '${n}': '${t}'`).join('\n')}\n`)
  run(pnpmBin(), ['add', pluginTgz], PROFILE_DIR)
  ok(`pnpm add ${basename(pluginTgz)} 成功`)
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  if (manifest.dependencies?.[PLUGIN] === undefined) fail(`profile manifest 里没有 ${PLUGIN} 依赖`)

  // bundles 变更只有**重启**后才生效。`--restart` 时脚本自己重启（verify 实例没有飞行守卫，
  // 这正是它存在的意义）；否则打印指引并还原，绝不留下半个插件。
  let needsReload = false
  if (!manifest.dsh.profile.bundles.includes(PLUGIN)) {
    manifest.dsh.profile.bundles.push(PLUGIN)
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
    ok(`bundles 已加入 ${PLUGIN}`)
    needsReload = true
  }
  if (needsReload) {
    if (!RESTART) {
      console.log('\n⚠️ 改了 profile 的 bundles，需要重启实例后才装载。加 --restart 让脚本自己重启：')
      console.log(`   node scripts/verify-plugin-install-e2e.mjs --home=${HOME} --port=${PORT} --restart`)
      console.log('   已还原 profile（不会留下半个插件）。')
      restore()
      process.exit(2)
    }
    console.log('── 2b. 重启实例让新 bundle 生效')
    run(join(ROOT, 'scripts', 'corum-instance.sh'), [
      'restart', `--home=${HOME}`, `--port=${PORT}`, '--allow-sandboxed',
    ], ROOT)
    // 等 CDP 应答（最多 60s）
    const deadline = Date.now() + 60_000
    let up = false
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) })
        if (res.ok) { up = true; break }
      } catch { /* 还没起来 */ }
      await new Promise(r => setTimeout(r, 1500))
    }
    if (!up) { fail(`实例重启后 ${PORT} 端口 60s 内没应答`); throw new Error('restart timeout') }
    if (!await waitForPageReady()) { fail('实例重启后页面 60s 内未就绪（readyState/token）'); throw new Error('page timeout') }
    ok('实例已重启、CDP 应答、页面就绪')
  }

  // ── 3. 断言宿主半挂载 ─────────────────────────────────────────────────
  console.log('── 3. 宿主半：pluginManager/list')
  // RPC 在**页面上下文**里发：页面已是认证态（同源 fetch 不带任何 token 也返回 200，
  // 2026-10-21 实测）。别去日志里抠 token —— 那把 token 只用于首次 loadURL 鉴权，
  // 拿来调 /api 会 `unauthorized`（踩过一次）。
  const entryJson = cdpEval(`(async () => {
    const r = await fetch('/api/pluginManager/list', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({type:'client-request',rpcId:'e2e-'+Math.random().toString(36).slice(2),method:'pluginManager/list',payload:{args:{}}}) })
    const b = await r.json()
    const hit = (b?.result?.value?.entries ?? []).find(e => e.moduleName === '${PLUGIN}')
    return JSON.stringify(hit ?? null)
  })()`)
  if (entryJson === null) fail(`${PLUGIN} 不在 pluginManager 列表里（loader 没挂上）`)
  else if (entryJson.fiberPhase !== 'active') fail(`${PLUGIN} 已注册但未 active（fiberPhase=${entryJson.fiberPhase}）`)
  else ok(`宿主半 active：entryId=${entryJson.entryId} kind=${entryJson.kind} hasUi=${entryJson.hasUi}`)

  // ── 4. 断言客户端半 ───────────────────────────────────────────────────
  console.log('── 4. 客户端半：boot 表 + client.js 可取')
  const clientJson = cdpEval(`(async () => {
    const e = (window.__DSH_BOOT__?.entries ?? []).find(x => x.id === '${PLUGIN}')
    if (e === undefined) return JSON.stringify({ found:false })
    const r = await fetch(e.url)
    const text = await r.text()
    return JSON.stringify({ found:true, url:e.url, status:r.status, bytes:text.length, banner:text.includes('__ModuleLoader__.load') })
  })()`)
  if (!clientJson.found) fail(`boot 表里没有 ${PLUGIN} 的 client 条目`)
  else if (clientJson.status !== 200) fail(`client.js 取不到：status=${clientJson.status}`)
  else if (!clientJson.banner) fail(`client.js 不是闭包形态（缺 __ModuleLoader__.load）`)
  else ok(`客户端半可取：${clientJson.bytes} 字节，闭包含 banner`)

  if (failures.length > 0) skip('现场保留在 profile 里，便于排查（脚本未还原）')
} finally {
  if (failures.length === 0) restore()
}

console.log(failures.length === 0
  ? `\n✅ 第三方插件安装端到端通过（${PLUGIN}）`
  : `\n❌ 端到端失败 ${failures.length} 项`)
process.exit(failures.length === 0 ? 0 : 1)
