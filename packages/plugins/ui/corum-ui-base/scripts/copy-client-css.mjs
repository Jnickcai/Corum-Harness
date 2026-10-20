/**
 * Copy the client-half stylesheets next to the compiled client JS.
 *
 * `tsc -b` emits `src/client/*.ts(x)` to `lib/types/client/*.js`, and those JS
 * files keep their relative `import './X.module.css'` specifiers verbatim. When
 * a consumer resolves `@corum/corum-ui-base/client` from **npm** (not from this
 * worktree), the CSS files must exist beside the compiled JS or the import
 * dies with MODULE_NOT_FOUND — the tsc output alone does not carry them.
 *
 * In-repo consumers bundle the same files by path, so this step is invisible to
 * them; it exists for the published artifact (P0 of
 * docs/plan/PLAN-2026-10-19-plugin-framework.md: `exports` must never point at
 * `./src/**`).
 *
 * Idempotent: it re-copies every time and removes nothing else.
 * @module shell-base/scripts/copy-client-css
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const srcDir = join(root, 'src', 'client')
const outDir = join(root, 'lib', 'types', 'client')

if (!existsSync(outDir)) {
  // tsc 没跑过 ⇒ 没有编译产物，复制 CSS 没有意义（也不该造出半个 lib/）。
  console.log('[copy-client-css] no lib/types/client; run tsc -b first. skipping')
  process.exit(1)
}

const cssFiles = readdirSync(srcDir).filter((name) => name.endsWith('.css'))
if (cssFiles.length === 0) {
  console.log('[copy-client-css] no stylesheets in src/client; skipping')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
for (const name of cssFiles) copyFileSync(join(srcDir, name), join(outDir, name))
console.log(`[copy-client-css] copied ${cssFiles.length} stylesheet(s) to lib/types/client`)
