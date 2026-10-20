#!/usr/bin/env node
/**
 * verify-plugin-guide.mjs —— 「指南说的都是真的」的守卫（防文档漂移）。
 *
 * ## 为什么需要它
 *
 * 本仓已经因为文档过时返工过一次：旧 `docs/plugin-template.md` 六处与代码不符
 * （命名不加前缀 / exports 用字符串 / 要求 `dsh.bundle` 但零包遵守 / cordis 版本写错 /
 * profile 路径含糊 / 未提三步构建）。**文档里的每条可执行断言都该有判据**，否则它只是在
 * 制造下次的返工。
 *
 * ## 判据（全部只读 + 一次临时目录里的脚手架冒烟）
 *
 * 1. 指南确实**随包发布**：SDK 的 `files` 含 `GUIDE.md`，`bin` 声明指向存在的文件；
 * 2. 指南提到的每个 API 在 SDK/契约包的产物 d.ts 里**真的导出**；
 * 3. 区域白名单（指南里写的三个区域）与 `@corum/plugin-ui-contract` 的实现**一致**；
 * 4. 脚手架 `corum-plugin-init` 生成物满足指南承诺的形状：
 *    `files` 含 `cordis.patch.yml`、依赖分层正确、build 是三步、有 `corum.plugin` 声明；
 *    失败即说明「照指南做出来的东西装不上」。
 *
 * 用法：`node scripts/verify-plugin-guide.mjs [--json]`；退出码 0 = 全绿。
 *
 * @module scripts/verify-plugin-guide
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SDK = join(ROOT, 'packages/sdk/corum-plugin-sdk')
const CONTRACT = join(ROOT, 'packages/sdk/corum-plugin-ui-contract')
const asJson = process.argv.includes('--json')
const failures = []
const ok = m => console.log(`  ✓ ${m}`)
const fail = m => { failures.push(m); console.log(`  ✗ ${m}`) }

// ── 1. 指南随包发布 ──────────────────────────────────────────────────────
console.log('── 1. 指南随包发布')
const sdkManifest = JSON.parse(readFileSync(join(SDK, 'package.json'), 'utf8'))
if (!(sdkManifest.files ?? []).includes('GUIDE.md')) fail('SDK 的 files 里没有 GUIDE.md（指南不会随包发布）')
else ok('SDK files 含 GUIDE.md')
if (!existsSync(join(SDK, 'GUIDE.md'))) fail('SDK 目录里没有 GUIDE.md')
const binPath = sdkManifest.bin?.['corum-plugin-init']
if (binPath === undefined) fail('SDK 没声明 corum-plugin-init bin')
else if (!existsSync(join(SDK, binPath))) fail(`bin 指向的文件不存在：${binPath}`)
else ok(`bin corum-plugin-init → ${binPath}`)

// ── 2. 指南提到的 API 真的导出 ────────────────────────────────────────────
console.log('── 2. 指南里的 API 在产物 d.ts 里真的导出')
const guide = readFileSync(join(SDK, 'GUIDE.md'), 'utf8')
const sdkIndexTypes = readFileSync(join(SDK, 'lib/types/index.d.ts'), 'utf8')
const sdkClientTypes = readFileSync(join(SDK, 'lib/types/client.d.ts'), 'utf8')
const contractTypes = readFileSync(join(CONTRACT, 'lib/types/index.d.ts'), 'utf8')
const anchors = [
  { api: 'definePlugin', where: sdkIndexTypes },
  { api: 'defineAgentTool', where: sdkIndexTypes },
  { api: 'registerAgentTool', where: sdkIndexTypes },
  { api: 'readSessionFacts', where: sdkClientTypes },
  { api: 'SessionFactsSnapshot', where: sdkIndexTypes },
  { api: 'registerRegionOverride', where: contractTypes },
  { api: 'registerSettingsSection', where: contractTypes },
  { api: 'REGION_OVERRIDE_SLOTS', where: contractTypes },
]
for (const { api, where } of anchors) {
  if (!guide.includes(api)) continue          // 指南没提就不必存在
  if (where.includes(api)) ok(`${api}（指南提到 ✓，产物导出 ✓）`)
  else fail(`指南提到 ${api}，但产物 d.ts 里没有`)
}

// ── 3. 区域白名单一致 ────────────────────────────────────────────────────
console.log('── 3. 区域白名单：指南 ↔ 契约包')
const contractSrc = readFileSync(join(CONTRACT, 'src/index.ts'), 'utf8')
const declared = [...contractSrc.matchAll(/'(corum\.(?:editor|trajectory|panel))'/g)].map(m => m[1])
const unique = [...new Set(declared)]
for (const slot of unique) {
  if (guide.includes(slot)) ok(`${slot} 两处一致`)
  else fail(`契约包声明了 ${slot}，指南没写`)
}

// ── 4. 脚手架冒烟（临时目录，跑完删除）────────────────────────────────────
console.log('── 4. 脚手架生成物满足指南承诺')
const work = mkdtempSync(join(tmpdir(), 'corum-guide-'))
try {
  for (const kind of ['k1', 'k2']) {
    const out = join(work, `probe-${kind}`)
    execFileSync(process.execPath, [join(SDK, 'bin/corum-plugin-init.mjs'), '--name', `@probe/p-${kind}`, '--dir', out, '--kind', kind], { cwd: work, stdio: 'ignore' })
    const manifest = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'))
    if (!(manifest.files ?? []).includes('cordis.patch.yml')) fail(`${kind}: files 缺 cordis.patch.yml（装不上）`)
    if (manifest.dependencies?.['@corum/plugin-sdk'] === undefined) fail(`${kind}: @corum/plugin-sdk 不在 dependencies`)
    if (manifest.dependencies?.['@deepseek-ai/cordis'] !== undefined) fail(`${kind}: 官方基座被写进 dependencies（会双实例）`)
    if (manifest.peerDependencies?.['@deepseek-ai/cordis'] === undefined) fail(`${kind}: 官方基座不在 peerDependencies`)
    if (manifest.corum?.plugin?.api !== 1) fail(`${kind}: 缺 corum.plugin 兼容声明`)
    const expectedBuild = kind === 'k2' ? 'tsc -b && tsdown && corum-inline-css' : 'tsc -b && tsdown'
    if (manifest.scripts?.build !== expectedBuild) fail(`${kind}: build 不是约定的三步/两步（实际 ${manifest.scripts?.build}）`)
    if (kind === 'k2' && manifest.dependencies?.['@corum/plugin-ui-contract'] === undefined) fail('k2: 缺 @corum/plugin-ui-contract 依赖')
    if (!existsSync(join(out, 'cordis.patch.yml'))) fail(`${kind}: 没生成 cordis.patch.yml`)
    ok(`${kind} 骨架形状正确`)
  }
} catch (error) {
  fail(`脚手架执行失败：${error instanceof Error ? error.message : String(error)}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (asJson) console.log(JSON.stringify({ failures }, null, 2))
console.log(failures.length === 0 ? '\n✅ 指南与实现一致（含脚手架冒烟）' : `\n❌ 指南漂移 ${failures.length} 项`)
process.exit(failures.length === 0 ? 0 : 1)
