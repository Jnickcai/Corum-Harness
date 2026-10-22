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

test('异步 hydrate 落地持久化值并通知一次；重复调用只生效第一次', async () => {
  assert.equal(typeof implementation.createDisplayPrefs, 'function')
  let hydrateCalls = 0
  const store = implementation.createDisplayPrefs({
    getItem: () => null,
    setItem() {},
    hydrate: async () => { hydrateCalls++; return { lineNumbers: 'relative', minimap: false } },
  })
  // 同步读到的是默认值——hydrate 之前不得阻塞调用方（这就是不 await 它的理由）。
  assert.equal(store.getPrefs().lineNumbers, 'on')
  let updates = 0
  store.subscribe(() => updates++)
  await store.hydrate()
  assert.equal(hydrateCalls, 1)
  assert.equal(updates, 1)
  assert.equal(store.getPrefs().lineNumbers, 'relative')
  assert.equal(store.getPrefs().minimap, false)
  await store.hydrate()
  assert.equal(hydrateCalls, 1)
  assert.equal(updates, 1)
})

test('用户在 hydrate 落地前改过的键不被覆盖，其余键仍取持久值', async () => {
  assert.equal(typeof implementation.createDisplayPrefs, 'function')
  const store = implementation.createDisplayPrefs({
    getItem: () => null,
    setItem() {},
    // 磁盘值：lineNumbers=relative、minimap=true
    hydrate: async () => ({ lineNumbers: 'relative', minimap: true }),
  })
  // 用户先关掉小地图（默认 true → false，是真实改动）。
  store.setPrefs({ minimap: false })
  await store.hydrate()
  // 按 key 保护：用户拨过的 minimap 保持 false（磁盘上的 true 不得改回去）……
  assert.equal(store.getPrefs().minimap, false)
  // ……没动过的 lineNumbers 仍拿到磁盘上的 relative（不能因为一次改动就整套退回默认）。
  assert.equal(store.getPrefs().lineNumbers, 'relative')
})

test('没有异步读入口时 hydrate 是空操作，不抛错也不通知', async () => {
  assert.equal(typeof implementation.createDisplayPrefs, 'function')
  const store = implementation.createDisplayPrefs({ getItem: () => null, setItem() {} })
  let updates = 0
  store.subscribe(() => updates++)
  await store.hydrate()
  assert.equal(updates, 0)
  assert.equal(store.getPrefs().lineNumbers, 'on')
})
