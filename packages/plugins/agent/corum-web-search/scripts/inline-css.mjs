/**
 * Fold the extracted stylesheet into the client bundle.
 *
 * tsdown's CSS pipeline (via @tsdown/css) extracts every stylesheet the client
 * half pulls in into `lib/style.css`. The client bundle is CJS and ships through
 * `window.__ModuleLoader__.load`, so it cannot `import` a CSS file and the
 * desktop loader serves no separate CSS asset. This post-build step reads that
 * stylesheet, prepends a <style> inject to `lib/client.js`, and removes the
 * now-redundant CSS file.
 *
 * **为什么本包必须有它**（即使本包自己没有 `*.module.css`）：本包 client 半值
 * import 了 `@corum/corum-ui-base/client`（借它的 `webSearchCredentialRef` —— 那条
 * 凭据引用规则的唯一家），而该包的 client 入口 import 了它自己的
 * `*.module.css`（RegionCard / FloatingLayer / ConfirmDialog / GridView /
 * MosaicWall）与 `base-theme.css`。tsdown 把它们内联进本 bundle 的同时，**规则
 * 文本被抽到 `lib/style.css`** ⇒ 没有这一步，本包产出的样式表就是一个加载器不会
 * 请求的文件（红线 6：只跑 tsdown 会让样式全丢）。包内含 `*.module.css` 的其余 19
 * 个包都是三步构建，本包只是同样地不能例外。
 *
 * Idempotent: if the CSS file is absent it exits 0 without touching anything.
 * @module corum-web-search/scripts/inline-css
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PLUGIN_ID = '@corum/corum-web-search'

const root = resolve(import.meta.dirname, '..')
const clientJs = join(root, 'lib', 'client.js')
const styleCss = join(root, 'lib', 'style.css')

if (!existsSync(styleCss) || !existsSync(clientJs)) {
  console.log('[inline-css] no stylesheet or client bundle; skipping')
  process.exit(0)
}

const cssText = readFileSync(styleCss, 'utf8')
const marker = `s.setAttribute('data-plugin','${PLUGIN_ID}')`
const inject = [
  `;(function(){if(typeof document!=='undefined'&&document.querySelector('style[data-plugin="${PLUGIN_ID}"]')===null){`,
  `var s=document.createElement('style');`,
  `s.setAttribute('data-plugin','${PLUGIN_ID}');`,
  `s.textContent=${JSON.stringify(cssText)};`,
  `document.head.appendChild(s);`,
  `}})();`,
].join('')

const client = readFileSync(clientJs, 'utf8')
// 幂等判定认**本插件专属标记**（不能认泛 `data-plugin`：业务源码里可能出现该字符串，
// corum-ide-plugin-manager-ui 就曾因 `data-plugin-manager-overlay` 被误判「已注入」）。
if (!client.includes(marker)) {
  writeFileSync(clientJs, inject + '\n' + client)
  console.log(`[inline-css] injected ${cssText.length} chars of CSS into client.js`)
} else {
  console.log('[inline-css] client.js already carries the stylesheet')
}
rmSync(styleCss, { force: true })
console.log('[inline-css] removed lib/style.css')
