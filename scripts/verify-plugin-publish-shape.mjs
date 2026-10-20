#!/usr/bin/env node
/**
 * P0 验收（发布形态实断）——「第三方从 npm 装到的到底是什么」。
 *
 * 背景：`exports` 指向 `./src/**` 时，本仓一切正常（工作区直接吃 TS 源码），
 * 但发布后第三方装到的是 .ts 文件，自己的 tsc/打包器一律解析失败。这不是
 * 编译期能发现的缺陷 —— 必须在**打包形态**下断言。见
 * docs/plan/PLAN-2026-10-19-plugin-framework.md §0.3 债 #12 / §E 验收判据。
 *
 * 做法（**必须在工作区之外**：放在仓内会被 pnpm 当成工作区项目，install 落到
 * 根上，装不出「第三方」的环境）：
 *
 *   1. `pnpm pack` 四个受 P0 影响的包 → .tgz（pack 会把 `workspace:` 换成真版本）
 *   2. 在 $TMPDIR 建一个独立工程，`pnpm install` 这些 tgz + react —— 这就是
 *      **真实的第三方安装**（不是解包模拟）
 *   3. 断言发布产物：exports 目标真实存在、types 是 .d.ts、default 是 .js、
 *      没有 .ts 源码、没有 `main`、有 `publishConfig`、没有 `private`
 *   4. 断言 ui-base 的 CSS 跟着编译后的 client JS 一起发布（否则第三方 install
 *      后 bundle 时报 MODULE_NOT_FOUND）
 *   5. 真跑 `tsc --noEmit`：第三方视角的 consumer.ts 从包入口 import 值 + 类型
 *   6. 真跑 `require.resolve`：Node 解析器对每个子路径给出的绝对路径
 *
 * 网络：步骤 2 用 `pnpm install`（不强制 --offline）——tgz 的 `^` 依赖可能需要
 * 从 registry 取。装不上时不判失败，而是标 SKIP 并说明（这一步验的是发布形态，
 * 不是 registry 可用性）。
 *
 * 用法：node scripts/verify-plugin-publish-shape.mjs
 * 退出码：0 = 全绿；1 = 任一断言失败（逐条打出失败项）
 *
 * @module scripts/verify-plugin-publish-shape
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const WORK = join(tmpdir(), 'corum-plugin-publish-shape')
const PACKS = join(WORK, 'packs')
const CONSUMER = join(WORK, 'consumer')

/** 受 P0 影响的四个包（path 相对 packages/plugins）。 */
const TARGETS = [
  'ui/corum-ui-base',
  'ui/corum-rpc-client',
  'agent/corum-tools',
  'agent/corum-fs-local',
]

const failures = []
const skips = []

function fail(message) {
  failures.push(message)
  console.log(`  ✗ ${message}`)
}

function skip(message) {
  skips.push(message)
  console.log(`  … SKIP ${message}`)
}

function ok(message) {
  console.log(`  ✓ ${message}`)
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** `pnpm` 在非登录 shell 里可能不在 PATH（本仓 2026-10-20 实测）。 */
function pnpmBin() {
  for (const candidate of ['/opt/homebrew/bin/pnpm', '/usr/local/bin/pnpm']) {
    if (existsSync(candidate)) return candidate
  }
  return 'pnpm'
}

/** 工作区里任一包的本地 tsc（根 node_modules 没有 typescript）。 */
function tscBin() {
  for (const rel of TARGETS) {
    const candidate = join(ROOT, 'packages', 'plugins', rel, 'node_modules', '.bin', 'tsc')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

rmSync(WORK, { recursive: true, force: true })
mkdirSync(PACKS, { recursive: true })
mkdirSync(CONSUMER, { recursive: true })

console.log(`── 0. 独立工程（工作区之外）：${WORK}`)
console.log('── 1. pnpm pack（发布形态）')
const packed = []
const deps = {}
for (const rel of TARGETS) {
  const dir = join(ROOT, 'packages', 'plugins', rel)
  let out
  try {
    out = run(pnpmBin(), ['pack', '--pack-destination', PACKS], dir)
  } catch (error) {
    fail(`${rel}: pnpm pack 失败 —— ${error.stderr ?? error.message}`)
    continue
  }
  const tgz = out.split('\n').map(line => line.trim()).filter(line => line.endsWith('.tgz')).pop()
  if (tgz === undefined) {
    fail(`${rel}: pnpm pack 没有产出 .tgz`)
    continue
  }
  const pkgName = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
  deps[pkgName] = `file:${tgz}`
  packed.push({ rel, pkgName, tgz })
  ok(`${pkgName} → ${tgz.split('/').pop()}`)
}

writeFileSync(join(CONSUMER, 'package.json'), `${JSON.stringify({
  name: 'third-party-consumer-probe',
  private: true,
  version: '0.0.0',
  type: 'module',
  dependencies: {
    ...deps,
    react: '^18.2.0',
    'react-dom': '^18.2.0',
    '@types/react': '~18.3.31',
    '@types/react-dom': '~18.3.0',
  },
}, null, 2)}\n`)

let installed = false
try {
  run(pnpmBin(), ['install', '--ignore-scripts'], CONSUMER)
  installed = true
  ok('pnpm install 成功 —— 以下断言都跑在「真实第三方安装」的 node_modules 上')
} catch (error) {
  skip(`pnpm install 失败（可能是 registry 不可达/版本未发布），跳过安装态断言：${(error.stderr ?? error.message).split('\n')[0]}`)
}

const installedPkgs = () => packed.map(({ rel, pkgName, tgz }) => {
  const dir = installed
    ? join(CONSUMER, 'node_modules', ...pkgName.split('/'))
    : undefined
  return { rel, pkgName, tgz, dir }
}).filter(entry => entry.dir !== undefined && existsSync(entry.dir))

if (installed) {
  console.log('── 2. 安装产物断言（exports 目标必须存在且不是 .ts 源码）')
  for (const { pkgName, dir } of installedPkgs()) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const files = []
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else files.push(full)
      }
    }
    walk(dir)
    const relFiles = new Set(files.map(f => f.slice(dir.length + 1).split('\\').join('/')))

    if (pkg.main !== undefined) fail(`${pkgName}: 仍带 main 字段（规范 §B.4 禁止）`)
    if (pkg.private === true) fail(`${pkgName}: 仍是 private（P0 要求可发布）`)
    if (pkg.publishConfig === undefined) fail(`${pkgName}: 缺 publishConfig`)

    const exportsEntries = Object.entries(pkg.exports ?? {})
    if (exportsEntries.length === 0) fail(`${pkgName}: 没有 exports`)
    for (const [subpath, value] of exportsEntries) {
      const conditions = typeof value === 'string' ? { default: value } : value
      for (const [condition, target] of Object.entries(conditions)) {
        if (typeof target !== 'string') continue
        const relPath = target.replace(/^\.\//, '')
        // `.d.ts` 以 `.ts` 结尾，但那是**声明**、正是发布产物；真源码（.ts/.tsx）才是缺陷。
        if (!relPath.endsWith('.d.ts') && (relPath.endsWith('.ts') || relPath.endsWith('.tsx'))) {
          fail(`${pkgName}: exports["${subpath}"].${condition} 指向 TS 源码 ${target}`)
          continue
        }
        if (!relFiles.has(relPath)) {
          fail(`${pkgName}: exports["${subpath}"].${condition} → ${target} 在包内不存在`)
          continue
        }
        if (condition === 'types' && !relPath.endsWith('.d.ts')) {
          fail(`${pkgName}: exports["${subpath}"].types 不是 .d.ts（${target}）`)
        }
      }
    }
    ok(`${pkgName}: exports 全部落到包内真实产物（${exportsEntries.length} 个子路径）`)

    if (pkgName === '@corum/corum-ui-base') {
      const css = [...relFiles].filter(f => f.endsWith('.css'))
      if (css.length === 0) fail(`${pkgName}: 包里没有任何 CSS —— 编译后的 client JS 会 import 失败`)
      else ok(`${pkgName}: ${css.length} 个 CSS 随产物发布（编译后 client JS 的相对 import 能解析）`)
      for (const required of ['lib/types/client/index.js', 'lib/types/client/index.d.ts']) {
        if (!relFiles.has(required)) fail(`${pkgName}: 缺 ${required}`)
      }
    }
  }

  console.log('── 3. Node 解析器实断（require.resolve 走 exports）')
  for (const { pkgName, dir } of installedPkgs()) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const req = createRequire(join(CONSUMER, 'index.mjs'))
    for (const subpath of Object.keys(pkg.exports ?? {})) {
      const specifier = subpath === '.' ? pkgName : `${pkgName}/${subpath.slice(2)}`
      try {
        const resolved = req.resolve(specifier)
        if (!resolved.endsWith('.d.ts') && (resolved.endsWith('.ts') || resolved.endsWith('.tsx'))) {
          fail(`${pkgName}: ${specifier} 解析到 TS 源码（${resolved}）`)
        }
        if (!existsSync(resolved)) fail(`${pkgName}: ${specifier} 解析到不存在的文件（${resolved}）`)
      } catch (error) {
        fail(`${pkgName}: ${specifier} 解析失败 —— ${error.message}`)
      }
    }
    ok(`${pkgName}: 全部子路径可被 Node 解析到真实文件`)
  }

  console.log('── 4. 第三方视角 typecheck（tsc --noEmit）')
  writeFileSync(join(CONSUMER, 'consumer.ts'), [
    "import { registerSlot, getSlotMeta } from '@corum/corum-ui-base/client'",
    "import { makeCorumRpcCall } from '@corum/corum-rpc-client/client'",
    "import type { CorumRpcCall } from '@corum/corum-rpc-client/client'",
    "import { defineTool } from '@corum/corum-tools'",
    '',
    'export const probe = { registerSlot, getSlotMeta, makeCorumRpcCall, defineTool }',
    'export type Probe = CorumRpcCall',
    '',
  ].join('\n'))
  writeFileSync(join(CONSUMER, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      module: 'esnext',
      moduleResolution: 'bundler',
      target: 'es2024',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      jsx: 'react-jsx',
      lib: ['ES2024', 'DOM', 'DOM.Iterable'],
      types: [],
    },
    include: ['consumer.ts'],
  }, null, 2)}\n`)

  const tsc = tscBin()
  if (tsc === undefined) {
    skip('找不到工作区里的 tsc 二进制，跳过类型消费断言')
  } else {
    try {
      run(tsc, ['-p', join(CONSUMER, 'tsconfig.json')], CONSUMER)
      ok('第三方 consumer.ts 从包入口 import 值与类型，tsc --noEmit 0 错')
    } catch (error) {
      fail(`第三方 consumer.ts typecheck 失败:\nstdout=${error.stdout ?? ''}\nstderr=${error.stderr ?? ''}`)
    }
  }
}

// 「pnpm pack 会把 workspace: 换成真版本」——P5 发布流水线的前置事实，值得记一笔。
if (installed) {
  const leftovers = installedPkgs().filter(({ dir }) =>
    readFileSync(join(dir, 'package.json'), 'utf8').includes('workspace:'))
  for (const { pkgName } of leftovers) skip(`${pkgName}: 打包产物里仍含 workspace: 协议`)
}

if (skips.length > 0) {
  console.log('── 跳过项')
  for (const s of skips) console.log(`  · ${s}`)
}

if (failures.length === 0) rmSync(WORK, { recursive: true, force: true })
console.log(failures.length === 0
  ? `\n✅ 发布形态验收全绿（${packed.length} 包；工作目录已清理）`
  : `\n❌ 发布形态验收失败 ${failures.length} 项（现场保留在 ${WORK}）`)
process.exit(failures.length === 0 ? 0 : 1)
