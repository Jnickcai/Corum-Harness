import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { validateStartupThemeManifest, importStartupTheme, listStartupThemes, selectStartupTheme, deleteStartupTheme, resolveStartupTheme } from '../lib/types/electron/startup-themes.js'
import { readStartupThemeArchive, validateThemePath } from '../lib/types/electron/startup-theme-archive.js'
import { readStartupThemeId } from '../lib/types/electron/startup-settings.js'

const assets = resolve('assets')
const manifest = { formatVersion: 1, id: 'sample', name: '示例', version: '1.0.0', type: 'html', entry: 'content/index.html' }
async function fixture(run) {
  const home = await mkdtemp(join(tmpdir(), 'corum-theme-'))
  try { await run(home) } finally { await rm(home, { recursive: true, force: true }) }
}
async function pack(home, fields = {}, extra = {}) {
  const value = { ...manifest, ...fields }
  const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(value)), [value.entry]: strToU8('<h1>theme</h1>'), ...extra })
  const path = join(home, 'theme.zip')
  await writeFile(path, zip)
  return path
}

test('主题 manifest 接受 HTML/视频，拒绝不支持版本、类型和包外路径', () => {
  assert.equal(validateStartupThemeManifest(manifest).id, 'sample')
  assert.equal(validateStartupThemeManifest({ ...manifest, type: 'video', entry: 'content/startup.webm' }).type, 'video')
  for (const patch of [{ formatVersion: 2 }, { id: '../escape' }, { id: 'CON' }, { type: 'script' }, { name: '' }, { version: '' }, { entry: '../index.html' }, { entry: 'C:/index.html' }, { entry: 'content\\index.html' }, { entry: 'content/index.html:stream' }, { preview: 'preview.svg' }, { background: 'red' }]) {
    assert.throws(() => validateStartupThemeManifest({ ...manifest, ...patch }))
  }
})

test('导入安装内容但不改变选择，切换持久化且保留其他偏好', () => fixture(async home => {
  await writeFile(join(home, 'desktop-settings.json'), JSON.stringify({ startupAnimationEnabled: false, other: 'kept' }))
  const installed = await importStartupTheme(await pack(home), home)
  assert.equal(installed.id, 'sample')
  assert.equal(await readFile(join(home, 'startup-themes/sample/content/index.html'), 'utf8'), '<h1>theme</h1>')
  assert.equal(readStartupThemeId(home), 'corum-terminal')
  await selectStartupTheme('sample', assets, home)
  assert.equal(readStartupThemeId(home), 'sample')
  assert.equal((await resolveStartupTheme(assets, undefined, home)).info.id, 'sample')
  assert.equal((await listStartupThemes(assets, home)).selectedId, 'sample')
  assert.equal(JSON.parse(await readFile(join(home, 'desktop-settings.json'), 'utf8')).other, 'kept')
  await assert.rejects(importStartupTheme(await pack(home), home), /已安装/)
  assert.equal(readStartupThemeId(home), 'sample')
}))

test('视频可以安装，删除当前主题回退内置，内置主题不能删除', () => fixture(async home => {
  await importStartupTheme(await pack(home, { type: 'video', entry: 'content/startup.mp4' }), home)
  await selectStartupTheme('sample', assets, home)
  await deleteStartupTheme('sample', home)
  assert.equal(readStartupThemeId(home), 'corum-terminal')
  assert.equal((await listStartupThemes(assets, home)).themes.length, 1)
  await assert.rejects(deleteStartupTheme('corum-terminal', home), /内置/)
}))

test('主题损坏或缺失时回退，目录内未完成安装不显示', () => fixture(async home => {
  await mkdir(join(home, 'startup-themes/broken'), { recursive: true })
  await writeFile(join(home, 'startup-themes/broken/manifest.json'), '{}')
  assert.equal((await resolveStartupTheme(assets, 'missing', home)).info.id, 'corum-terminal')
  assert.equal((await listStartupThemes(assets, home)).themes.length, 1)
  await assert.rejects(selectStartupTheme('broken', assets, home))
}))

test('缺少入口的导入失败不留下主题或修改选择', () => fixture(async home => {
  const path = join(home, 'bad.zip')
  await writeFile(path, zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) }))
  await assert.rejects(importStartupTheme(path, home), /入口/)
  assert.equal(readStartupThemeId(home), 'corum-terminal')
  assert.deepEqual(await readdir(join(home, 'startup-themes')).catch(() => []), [])
}))

test('ZIP 拒绝越界路径、Windows 别名、重复条目和 symlink', () => fixture(async home => {
  for (const name of ['../escape', '/absolute', 'C:/escape', 'dir\\escape', 'a:stream', 'file.', 'CON.txt']) {
    const path = await pack(home, {}, { [name]: strToU8('x') })
    await assert.rejects(readStartupThemeArchive(path), undefined, name)
  }
  await assert.rejects(readStartupThemeArchive(await pack(home, {}, { 'CONTENT/INDEX.HTML': strToU8('duplicate') })), /重复/)
  const linkZip = zipSync({ link: [strToU8('/outside'), { os: 3, attrs: 0o120777 << 16 }] })
  await writeFile(join(home, 'link.zip'), linkZip)
  await assert.rejects(readStartupThemeArchive(join(home, 'link.zip')), /链接/)
}))

test('ZIP 核对本地头、解压大小和 CRC，按实际字节限量解压', () => fixture(async home => {
  const good = await readFile(await pack(home))
  const localMismatch = Buffer.from(good)
  localMismatch[30] ^= 1
  await writeFile(join(home, 'mismatch.zip'), localMismatch)
  await assert.rejects(readStartupThemeArchive(join(home, 'mismatch.zip')), /不一致/)
  const wrongSize = Buffer.from(good)
  const central = wrongSize.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  wrongSize.writeUInt32LE(1, central + 24)
  await writeFile(join(home, 'size.zip'), wrongSize)
  await assert.rejects(readStartupThemeArchive(join(home, 'size.zip')))
  await assert.rejects(readStartupThemeArchive(join(home, 'theme.zip'), { maxBytes: 4 }), /大小/)
  await assert.rejects(readStartupThemeArchive(join(home, 'theme.zip'), { maxFiles: 1 }), /数量/)
  const files = await readStartupThemeArchive(join(home, 'theme.zip'))
  assert.equal(files.get('content/index.html').length, 14)
}))

test('ZIP 目录条目也受数量上限约束，避免大量空目录阻塞导入', () => fixture(async home => {
  const path = join(home, 'directories.zip')
  await writeFile(path, zipSync({ 'a/': new Uint8Array(), 'b/': new Uint8Array() }))
  await assert.rejects(readStartupThemeArchive(path, { maxFiles: 1 }), /数量/)
}))

test('主题 JSON Schema 的路径约定与运行期校验一致', async () => {
  const schema = JSON.parse(await readFile('startup-theme-kit/theme.schema.json', 'utf8'))
  const pathPattern = new RegExp(schema.$defs.path.pattern)
  for (const path of ['content/index.html', '中文/主题.html', 'font/my font.woff2', '../x', 'a/./b', 'a//b', 'a\\b', 'a\0b', 'CON.txt', 'a:stream', 'a/file.', '/absolute']) {
    let valid = true
    try { validateThemePath(path) } catch { valid = false }
    assert.equal(pathPattern.test(path), valid, path)
  }
})
