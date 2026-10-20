#!/usr/bin/env node
/**
 * verify-plugin-ui-surface.mjs —— 第三方插件「能碰哪些 UI 面」的静态守卫。
 *
 * ## 为什么要有这条守卫
 *
 * 槽注册是**运行时全开放**的：官方 `ctx.slots.register` 不认识「谁能注册哪个键」。
 * 所以「插件只能覆盖右侧区域 + 在设置扩展里加一页」这条产品边界，只能靠
 * ①契约包（`@corum/plugin-ui-contract` 提供类型与 helper）、②这条静态守卫、③review
 * 三层一起守。少了②，第一个绕过契约的插件就能往会话流里塞东西 —— 而那正是
 * 用户明确禁止的（"壳布局不要被改，插件只能增加右侧区域的覆盖"）。
 *
 * ## 判据（对 `examples/*` 与 `CORUM_THIRD_PARTY_PLUGINS` 列出的包）
 *
 * - `error` **槽键不在白名单**：只允许 `corum.editor` / `corum.trajectory` / `corum.panel`
 *   / `settings.section`。`conversation.*`、`settings.general.item`、`corum.sidebar` 等
 *   一律拒绝（它们的 owner props 契约在 corum 内部层包里）。
 * - `error` **碰布局**：`showRegion` / `setRegionHidden` / `toggleRegion` / `resetLayout`
 *   / `closeRegion` 一次都不许调 —— 布局归壳；插件接管区域后由壳自动点亮。
 * - `warn` **直接 `ctx.slots.register` 注册区域槽**：能跑，但绕过了契约包的
 *   `slots.inject` + `priority: -1` 组合；请用 `registerRegionOverride()`。
 *
 * ## 用法
 *
 *   node scripts/verify-plugin-ui-surface.mjs            # 人读报告
 *   node scripts/verify-plugin-ui-surface.mjs --json     # 机器可读
 *
 * 退出码：0 = 无 error；1 = 有 error。
 *
 * @module scripts/verify-plugin-ui-surface
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const asJson = process.argv.includes('--json')

/** 与 `@corum/plugin-ui-contract` 的 `PLUGIN_UI_SLOTS` 必须一致（契约测试会盯这一致性）。 */
const ALLOWED_SLOTS = new Set(['corum.editor', 'corum.trajectory', 'corum.panel', 'settings.section'])

/** 布局写入面：插件一律不许碰。 */
const LAYOUT_MUTATIONS = ['showRegion', 'setRegionHidden', 'toggleRegion', 'resetLayout', 'closeRegion']

/** 待检查的插件源码根（第三方形态的样例；后续可加 `--include=<glob>`）。 */
const SCAN_ROOTS = [
  join(ROOT, 'examples'),
]

/** 递归收集 .ts/.tsx 源文件。 */
function sources(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'lib') continue
        walk(full)
      } else if (/\.(ts|tsx)$/.test(entry)) {
        out.push(full)
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

/** 逐个插件包（有 package.json 且含 src/ 的目录）。 */
function pluginPackages() {
  const packages = []
  for (const root of SCAN_ROOTS) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      const dir = join(root, name)
      if (!statSync(dir).isDirectory()) continue
      if (!existsSync(join(dir, 'package.json'))) continue
      packages.push(dir)
    }
  }
  return packages
}

const errors = []
const warns = []
const findings = []

for (const dir of pluginPackages()) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  for (const file of sources(join(dir, 'src'))) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(ROOT, file)
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 剥块注释：注释里提到的键名不算违规
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

    // ① 槽键：抓 register({ name: 'x' }) / inject('x') / slot: 'x'
    const usedKeys = new Set()
    for (const m of code.matchAll(/name:\s*'([^']+)'/g)) usedKeys.add(m[1])
    for (const m of code.matchAll(/slots\.inject\(\s*'([^']+)'/g)) usedKeys.add(m[1])
    for (const m of code.matchAll(/slot:\s*'([^']+)'/g)) usedKeys.add(m[1])
    for (const key of usedKeys) {
      if (!key.includes('.')) continue            // 服务名/其它字符串，不是槽键
      if (ALLOWED_SLOTS.has(key)) continue
      const message = `${manifest.name}: ${rel} 注册了白名单外的槽 "${key}"（只允许 ${[...ALLOWED_SLOTS].join(' / ')}）`
      errors.push(message)
      findings.push({ level: 'error', pkg: manifest.name, file: rel, key, message })
    }

    // ② 布局写入面
    for (const name of LAYOUT_MUTATIONS) {
      const pattern = new RegExp(`\\.${name}\\s*\\(`)
      if (pattern.test(code)) {
        const message = `${manifest.name}: ${rel} 调用了布局写入面 .${name}() —— 布局归壳，插件不得修改`
        errors.push(message)
        findings.push({ level: 'error', pkg: manifest.name, file: rel, key: name, message })
      }
    }

    // ③ 直接注册区域槽（绕过契约包）
    for (const key of ['corum.editor', 'corum.trajectory', 'corum.panel']) {
      const direct = new RegExp(`slots\\.register\\(\\s*\\{[^}]*name:\\s*'${key.replace('.', '\\.')}'`)
      if (direct.test(code)) {
        const message = `${manifest.name}: ${rel} 直接 slots.register 注册区域槽 "${key}"（请用 @corum/plugin-ui-contract 的 registerRegionOverride）`
        warns.push(message)
        findings.push({ level: 'warn', pkg: manifest.name, file: rel, key, message })
      }
    }
  }
}

const scanned = pluginPackages().length
if (asJson) {
  console.log(JSON.stringify({ packages: scanned, errors, warns }, null, 2))
} else {
  console.log(`插件 UI 面守卫（${scanned} 个第三方样例包；白名单 ${[...ALLOWED_SLOTS].join(' / ')}）\n`)
  if (errors.length === 0 && warns.length === 0) console.log('  ✓ 全部插件只用了契约允许的 UI 面')
  for (const message of errors) console.log(`  ✗ ${message}`)
  for (const message of warns) console.log(`  ⚠ ${message}`)
  console.log(`\n结论：error ${errors.length} / warn ${warns.length}`)
}
process.exit(errors.length === 0 ? 0 : 1)
