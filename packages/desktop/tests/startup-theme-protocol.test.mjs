import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readStartupThemeResource } from '../lib/types/electron/startup-theme-resource.js'
const info = { id: 'sample', type: 'video', entry: 'clip.webm', builtin: false }
async function fixture(run) {
  const base = await mkdtemp(join(tmpdir(), 'corum-theme-resource-'))
  const root = join(base, 'theme')
  await mkdir(root)
  await writeFile(join(root, 'clip.webm'), '0123456789')
  await writeFile(join(base, 'outside.txt'), 'private')
  try { await run({ info, root }, base) } finally { await rm(base, { recursive: true, force: true }) }
}
const request = (path = 'clip.webm', range) => new Request(`corumapp://startup-theme/sample/${path}`, { headers: range ? { range } : {} })

test('主题资源返回正确媒体类型，支持整文件与首段、尾段、开放 Range', () => fixture(async theme => {
  const whole = await readStartupThemeResource(theme, request())
  assert.equal(whole.status, 200)
  assert.equal(whole.headers.get('content-type'), 'video/webm')
  assert.equal(await whole.text(), '0123456789')
  for (const [range, expected, contentRange] of [['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-', '89', 'bytes 8-9/10']]) {
    const response = await readStartupThemeResource(theme, request('clip.webm', range))
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), contentRange)
    assert.equal(await response.text(), expected)
  }
  for (const range of ['bytes=20-', 'bytes=1-0', 'bytes=0-1,4-5', 'bytes=-0']) assert.equal((await readStartupThemeResource(theme, request('clip.webm', range))).status, 416)
}))

test('资源协议拒绝其他主题、编码越界和 Windows 路径；不存在资源返回 404', () => fixture(async theme => {
  for (const path of ['%2e%2e%2foutside.txt', '%2e%2e%5coutside.txt', 'C%3a/outside.txt', 'clip.webm%3astream']) assert.equal((await readStartupThemeResource(theme, request(path))).status, 403)
  assert.equal((await readStartupThemeResource(theme, new Request('corumapp://startup-theme/other/clip.webm'))).status, 403)
  assert.equal((await readStartupThemeResource(theme, request('missing.webm'))).status, 404)
}))

test('资源协议通过 realpath 拒绝跨目录链接', () => fixture(async (theme, base) => {
  const outside = join(base, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'private.txt'), 'private')
  await symlink(outside, join(theme.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await readStartupThemeResource(theme, request('linked/private.txt'))).status, 403)
}))
