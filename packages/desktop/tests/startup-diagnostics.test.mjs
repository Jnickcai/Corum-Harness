import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderStartupPageHtml } from '../lib/types/electron/startup-page.js'

/**
 * 启动页是「host 死了也要能报错」的落点（方案 §C.3）：host 死在装载阶段时
 * renderer 仍活着、启动页有完整画布。所以这里钉住三件事：
 *   1. 诊断容器存在（否则报错无处可显示）；
 *   2. 渲染走 textContent（包名来自第三方，不能拼 innerHTML）；
 *   3. 接口缺失时静默降级（老 preload / 预览器没有 bridge 时不能把启动页弄死）。
 */
const html = renderStartupPageHtml({
  theme: { id: 'default', label: '默认', background: '#000' },
  animationEnabled: false,
  preview: false,
  platform: 'darwin',
})

test('启动页含诊断容器', () => {
  assert.match(html, /id="diagnostics"/)
})

test('诊断渲染走 textContent，不拼 innerHTML', () => {
  assert.match(html, /renderBootDiagnostics/)
  assert.match(html, /textContent/)
  assert.doesNotMatch(html, /diagnosticsEl\.innerHTML/)
})

test('无 bridge / 无该方法时静默降级', () => {
  assert.match(html, /typeof bridge\.getBootDiagnostics==='function'/)
  assert.match(html, /\.catch\(\(\)=>\{\}\)/)
})
