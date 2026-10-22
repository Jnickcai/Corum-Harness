import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as desktopSettings from '../lib/types/electron/startup-settings.js'

const implementation = await import('../lib/types/client/editor/display-prefs.js').catch(() => ({}))
test('显示偏好提供可订阅、可持久化的独立 store', () => {
  assert.equal(typeof implementation.createDisplayPrefs, 'function')
})

test('修改立即通知订阅方，重建 store 后保留值；无变化不通知', () => {
  assert.equal(typeof implementation.createDisplayPrefs, 'function')
  const data = new Map()
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  const store = implementation.createDisplayPrefs(storage)
  assert.equal(store.getPrefs().lineNumbers, 'on')
  let updates = 0
  const dispose = store.subscribe(() => updates++)
  store.setPrefs({ lineNumbers: 'relative', minimap: false, smoothMotion: false })
  assert.equal(updates, 1)
  assert.equal(store.getPrefs().minimap, false)
  assert.deepEqual(implementation.createDisplayPrefs(storage).getPrefs(), store.getPrefs())
  store.setPrefs({ minimap: false })
  assert.equal(updates, 1)
  dispose()
  store.setPrefs({ minimap: true })
  assert.equal(updates, 1)
})

test('损坏及无效字段逐项回退，false 和合法枚举值被保留', () => {
  assert.equal(typeof implementation.createDisplayPrefs, 'function')
  const store = implementation.createDisplayPrefs({ getItem: () => JSON.stringify({ lineNumbers: 'invalid', minimap: false, renderWhitespace: 'all', smoothMotion: 'false', unknown: true }), setItem() {} })
  assert.equal(store.getPrefs().lineNumbers, 'on')
  assert.equal(store.getPrefs().minimap, false)
  assert.equal(store.getPrefs().renderWhitespace, 'all')
  assert.equal(store.getPrefs().smoothMotion, true)
  assert.equal(store.getPrefs().unknown, undefined)
  store.setPrefs({ lineNumbers: 'invalid', guides: 'yes' })
  assert.equal(store.getPrefs().guides, true)
})

test('存储不可用仍可在本次会话修改；非法 JSON 回退默认值', () => {
  assert.equal(typeof implementation.createDisplayPrefs, 'function')
  const store = implementation.createDisplayPrefs({ getItem: () => '{', setItem() { throw Error('storage unavailable') } })
  store.setPrefs({ scrollBeyondLastLine: true })
  assert.equal(store.getPrefs().scrollBeyondLastLine, true)
})

test('显示偏好写入桌面配置，独立于端口且保留其他设置', () => {
  assert.equal(typeof desktopSettings.writeEditorDisplayPrefs, 'function')
  const home = mkdtempSync(join(tmpdir(), 'corum-display-prefs-'))
  try {
    const file = join(home, 'desktop-settings.json')
    writeFileSync(file, JSON.stringify({ startupAnimationEnabled: false, other: 'kept' }))
    const prefs = { ...implementation.createDisplayPrefs({ getItem: () => null, setItem() {} }).getPrefs(), minimap: false }
    desktopSettings.writeEditorDisplayPrefs(prefs, home)
    assert.deepEqual(desktopSettings.readEditorDisplayPrefs(home), prefs)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).other, 'kept')
    assert.equal(desktopSettings.readStartupAnimationEnabled(home), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
