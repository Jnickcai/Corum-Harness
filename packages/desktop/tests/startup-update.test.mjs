import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { judgePendingUpdate, isNewerVersion, clearPendingUpdateState } from '../lib/types/electron/startup-update.js'

/**
 * 「下次启动自动安装」的判定逻辑测试。
 *
 * 这组断言保护的是**安全边界**：判断错误会导致用户失去可用应用
 * （安装脚本会替换正在运行的 .app）。所以每条「不该装」的分支都必须钉住。
 */

/** 更简洁的用途：直接跑回调。 */
async function withDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'corum-pending-'))
  try { await run(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

const stateFile = (version, filename, size) => JSON.stringify({ version, filename, size })

test('isNewerVersion：只认严格更新，解析失败一律 false（安全侧）', () => {
  assert.equal(isNewerVersion('0.5.0', '0.6.0'), true)
  assert.equal(isNewerVersion('0.6.0', '0.6.0'), false)
  assert.equal(isNewerVersion('0.6.0', '0.5.0'), false)
  assert.equal(isNewerVersion('0.9.0', '0.10.0'), true)   // 数字比较，不是字符串
  assert.equal(isNewerVersion('1.0.0', '1.0.1'), true)
  // 解析失败 ⇒ 不装（宁可漏装一次，也不能装错）
  assert.equal(isNewerVersion('garbage', '0.6.0'), false)
  assert.equal(isNewerVersion('0.6.0', 'garbage'), false)
  assert.equal(isNewerVersion('', ''), false)
})

test('没有状态文件 ⇒ 不装', () => withDir(async (dir) => {
  const v = judgePendingUpdate(dir, '0.5.0')
  assert.equal(v.kind, 'none')
}))

test('状态文件损坏 ⇒ invalid（不装）', () => withDir(async (dir) => {
  await writeFile(join(dir, 'update-state.json'), '{not json')
  const v = judgePendingUpdate(dir, '0.5.0')
  assert.equal(v.kind, 'invalid')
}))

test('缺 version/filename ⇒ invalid', () => withDir(async (dir) => {
  await writeFile(join(dir, 'update-state.json'), JSON.stringify({ size: 10 }))
  assert.equal(judgePendingUpdate(dir, '0.5.0').kind, 'invalid')
}))

test('记录版本不比当前新 ⇒ none（防止「每次启动都重装」死循环）', () => withDir(async (dir) => {
  const name = 'Corum-0.5.0-arm64-mac.zip'
  await writeFile(join(dir, name), 'payload')
  await writeFile(join(dir, 'update-state.json'), stateFile('0.5.0', name, 7))
  const v = judgePendingUpdate(dir, '0.5.0')
  assert.equal(v.kind, 'none')
}))

test('下载文件不存在 ⇒ invalid', () => withDir(async (dir) => {
  await writeFile(join(dir, 'update-state.json'), stateFile('0.6.0', 'Corum-0.6.0-arm64-mac.zip', 7))
  const v = judgePendingUpdate(dir, '0.5.0')
  assert.equal(v.kind, 'invalid')
}))

test('文件大小与记录不一致 ⇒ invalid（半包/被改动）', () => withDir(async (dir) => {
  const name = 'Corum-0.6.0-arm64-mac.zip'
  await writeFile(join(dir, name), 'short')
  await writeFile(join(dir, 'update-state.json'), stateFile('0.6.0', name, 999))
  const v = judgePendingUpdate(dir, '0.5.0')
  assert.equal(v.kind, 'invalid')
  assert.match(v.reason, /size mismatch/)
}))

test('全部条件满足 ⇒ ready，且给出正确路径', () => withDir(async (dir) => {
  const name = 'Corum-0.6.0-arm64-mac.zip'
  const payload = 'x'.repeat(100)
  await writeFile(join(dir, name), payload)
  await writeFile(join(dir, 'update-state.json'), stateFile('0.6.0', name, 100))
  const v = judgePendingUpdate(dir, '0.5.0')
  assert.equal(v.kind, 'ready')
  assert.equal(v.version, '0.6.0')
  assert.equal(v.path, join(dir, name))
}))

test('size 记录为 0 时跳过大小校验（老状态文件兼容）', () => withDir(async (dir) => {
  const name = 'Corum-0.6.0-arm64-mac.zip'
  await writeFile(join(dir, name), 'anything')
  await writeFile(join(dir, 'update-state.json'), stateFile('0.6.0', name, 0))
  assert.equal(judgePendingUpdate(dir, '0.5.0').kind, 'ready')
}))

test('clearPendingUpdateState：删掉状态文件后不再判定为待装', () => withDir(async (dir) => {
  const name = 'Corum-0.6.0-arm64-mac.zip'
  await writeFile(join(dir, name), 'x')
  await writeFile(join(dir, 'update-state.json'), stateFile('0.6.0', name, 1))
  assert.equal(judgePendingUpdate(dir, '0.5.0').kind, 'ready')
  assert.equal(clearPendingUpdateState(dir), true)
  assert.equal(judgePendingUpdate(dir, '0.5.0').kind, 'none')
}))
