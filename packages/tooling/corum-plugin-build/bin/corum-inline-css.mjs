#!/usr/bin/env node
/**
 * corum-inline-css —— 把 tsdown 抽出的样式表折进 client 闭包（**唯一实现**）。
 *
 * ## 为什么必须有这一步（红线 6）
 *
 * tsdown 的 CSS 管线会把组件 import 的所有样式抽成外置的 `lib/style.css`。而客户端半
 * 的产物是 CJS 闭包（`window.__ModuleLoader__.load`），**不能 import CSS 文件**，
 * 桌面 loader 也不提供单独的 CSS 资源通道。于是：
 *
 * - 跑 `tsdown` 而不内联 ⇒ 实机**样式全丢**（裸 UI、`--corum-glass-1` 为空），
 *   **而且不报任何错**（2026-10-06 实测，LESSONS §1.1c）；
 * - 只跑 `inline-css` 而不跑 `tsdown` ⇒ 没有 `client.js` 可注入。
 *
 * 三步（`tsc -b && tsdown && corum-inline-css`）缺一不可，这也是插件规范 §7 的判据。
 *
 * ## 用法
 *
 *   在**包根目录**运行（build 脚本里直接写 `corum-inline-css`）：
 *
 *     corum-inline-css                       # 读本包 package.json 的 name 作插件 id
 *     corum-inline-css --id @corum/x --client lib/client.js --css lib/style.css
 *
 * 幂等：`client.js` 已带本插件专属标记 ⇒ 不重复注入；没有样式表 ⇒ 退出 0 不动任何文件。
 *
 * @module @corum/plugin-build/bin/corum-inline-css
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const cwd = process.cwd()

function arg(name, fallback) {
  const inline = process.argv.find(a => a.startsWith(`--${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1]
  return fallback
}

/** 插件 id：显式 `--id` > 本包 `package.json` 的 `name`。**绝不猜**。 */
function resolveId() {
  const explicit = arg('id', undefined)
  if (explicit !== undefined) return explicit
  const manifestPath = join(cwd, 'package.json')
  if (!existsSync(manifestPath)) {
    console.error('[corum-inline-css] 找不到 package.json 且未给 --id；请在包根目录运行或显式传 --id')
    process.exit(2)
  }
  const name = JSON.parse(readFileSync(manifestPath, 'utf8')).name
  if (typeof name !== 'string' || name === '') {
    console.error('[corum-inline-css] package.json 没有 name；请显式传 --id')
    process.exit(2)
  }
  return name
}

const id = resolveId()
const clientJs = resolve(cwd, arg('client', join('lib', 'client.js')))
const styleCss = resolve(cwd, arg('css', join('lib', 'style.css')))

// 没有外置样式表或没有 client 产物 ⇒ 不做任何事、退出 0。
// （「没有 CSS 的插件」是合法形态：4 个 K2 包就是 0 个 CSS。）
if (!existsSync(styleCss) || !existsSync(clientJs)) {
  console.log('[corum-inline-css] 没有样式表或没有 client 产物；跳过（这不等于失败）')
  process.exit(0)
}

const cssText = readFileSync(styleCss, 'utf8')
const marker = `s.setAttribute('data-plugin','${id}')`
const inject = [
  `;(function(){if(typeof document!=='undefined'&&document.querySelector('style[data-plugin="${id}"]')===null){`,
  'var s=document.createElement(\'style\');',
  `${marker};`,
  `s.textContent=${JSON.stringify(cssText)};`,
  'document.head.appendChild(s);',
  '}})();',
].join('')

const client = readFileSync(clientJs, 'utf8')
// 幂等判定必须认**本插件专属标记**（不能认泛 'data-plugin'：业务源码里可能出现该
// 字符串 —— corum-ide-plugin-manager-ui 就因 data-plugin-manager-overlay 被误判
// 「已注入」，样式长期不注入）。
if (!client.includes(marker)) {
  writeFileSync(clientJs, `${inject}\n${client}`)
  console.log(`[corum-inline-css] ${id}：注入 ${cssText.length} 字符 CSS`)
} else {
  console.log(`[corum-inline-css] ${id}：client 已带样式表`)
}
rmSync(styleCss, { force: true })
console.log(`[corum-inline-css] ${id}：已移除外置 lib/style.css`)
