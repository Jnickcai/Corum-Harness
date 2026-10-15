import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StartupGate } from '../lib/types/electron/startup-state.js'
import { readStartupAnimationEnabled, writeStartupAnimationEnabled } from '../lib/types/electron/startup-settings.js'
import { HostBridgeClient } from '../lib/types/electron/bridge-client.js'

test('后台先就绪时，保留动画直至播放完毕或跳过', () => {
  let entered = 0
  const gate = new StartupGate(() => { entered++ }, true)
  gate.ready()
  assert.equal(entered, 0)
  gate.finish()
  assert.equal(entered, 1)
})

test('提前跳过动画时，仍需等待主界面就绪', () => {
  let entered = 0
  const gate = new StartupGate(() => { entered++ }, true)
  gate.finish()
  assert.equal(entered, 0)
  gate.ready()
  assert.equal(entered, 1)
})

test('启动失败后，迟到的就绪或动画结束信号不能掩盖错误', () => {
  let entered = 0
  const gate = new StartupGate(() => { entered++ }, true)
  gate.fail()
  gate.finish()
  gate.ready()
  assert.equal(entered, 0)
})

test('关闭动画时，主界面就绪后直接进入且只进入一次', () => {
  let entered = 0
  const gate = new StartupGate(() => { entered++ }, false)
  gate.ready()
  gate.ready()
  gate.finish()
  assert.equal(entered, 1)
})

test('旧配置默认开启动画，保存关闭后重读生效并保留其他偏好', () => {
  const home = mkdtempSync(join(tmpdir(), 'corum-startup-'))
  try {
    assert.equal(readStartupAnimationEnabled(home), true)
    writeFileSync(join(home, 'desktop-settings.json'), JSON.stringify({ other: 'preserved' }))
    assert.equal(readStartupAnimationEnabled(home), true)
    writeStartupAnimationEnabled(false, home)
    assert.equal(readStartupAnimationEnabled(home), false)
    assert.equal(JSON.parse(readFileSync(join(home, 'desktop-settings.json'), 'utf8')).other, 'preserved')
    writeStartupAnimationEnabled(true, home)
    assert.equal(readStartupAnimationEnabled(home), true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('后台就绪前退出会报告失败，而不是永久等待', async () => {
  const home = mkdtempSync(join(tmpdir(), 'corum-startup-host-'))
  const entry = join(home, 'exit.cjs')
  writeFileSync(entry, 'process.exit(7)')
  const bridge = new HostBridgeClient(process.execPath, entry)
  let timer
  try {
    await assert.rejects(Promise.race([
      bridge.ready(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('等待超时')), 1500) }),
    ]), /code 7/)
  } finally {
    clearTimeout(timer)
    bridge.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})

test('后台进程存活但迟迟未就绪时，超时报错并停止等待', async () => {
  const home = mkdtempSync(join(tmpdir(), 'corum-startup-timeout-'))
  const entry = join(home, 'hang.cjs')
  writeFileSync(entry, 'setInterval(() => {}, 1000)')
  const bridge = new HostBridgeClient(process.execPath, entry, undefined, undefined, 100)
  let timer
  try {
    await assert.rejects(Promise.race([
      bridge.ready(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('未触发启动超时')), 1000) }),
    ]), /后台启动超时/)
  } finally {
    clearTimeout(timer)
    bridge.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})
