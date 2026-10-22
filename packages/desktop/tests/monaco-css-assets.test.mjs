import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import vm from 'node:vm'

test('内联 Monaco CSS 时嵌入真实 codicon 字体，产物不再依赖页面相对资源', () => {
  const root = mkdtempSync(join(tmpdir(), 'corum-monaco-css-'))
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'lib'))
    const fontDir = join(root, 'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon')
    mkdirSync(fontDir, { recursive: true })
    const font = readFileSync('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf')
    writeFileSync(join(fontDir, 'codicon.ttf'), font)
    copyFileSync('scripts/inline-monaco-css.mjs', join(root, 'scripts/inline-monaco-css.mjs'))
    writeFileSync(join(root, 'lib/client.js'), 'globalThis.clientLoaded = true')
    writeFileSync(join(root, 'lib/style.css'), '@font-face{font-family:codicon;src:url("./codicon.ttf") format("truetype")}')
    execFileSync(process.execPath, [join(root, 'scripts/inline-monaco-css.mjs')])
    let style
    vm.runInNewContext(readFileSync(join(root, 'lib/client.js'), 'utf8'), {
      document: { querySelector: () => null, createElement: () => ({ setAttribute() {} }), head: { appendChild: value => { style = value.textContent } } },
    })
    const encoded = style.match(/data:font\/ttf;base64,([A-Za-z0-9+/=]+)/)?.[1]
    assert.ok(encoded, '字体仍是相对路径，独立加载的 client.js 会请求错误的字体 URL')
    assert.deepEqual(Buffer.from(encoded, 'base64'), font)
    assert.equal(existsSync(join(root, 'lib/style.css')), false)
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir())))
    rmSync(root, { recursive: true, force: true })
  }
})
