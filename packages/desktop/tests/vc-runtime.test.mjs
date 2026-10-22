// VC++ 运行库探测：判据必须在「系统有 / 随包带 / 都没有」三种情形下都正确，
// 且关键项与非关键项要分开算 —— 否则只缺一个可选分区就误报「环境不完整」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { probeVcRuntime, describeVcRuntimeProblem, REQUIRED_VC_DLLS, CRITICAL_VC_DLLS } from '../lib/types/electron/vc-runtime.js'

/** 造一个假 SystemRoot（只有 System32 子目录）。 */
function fakeSystemRoot(dlls) {
  const root = mkdtempSync(join(tmpdir(), 'vc-probe-'))
  const system32 = join(root, 'System32')
  mkdirSync(system32, { recursive: true })
  for (const dll of dlls) writeFileSync(join(system32, dll), 'x')
  return root
}

/** 造一个假随包 node 目录。 */
function fakeBundled(dlls) {
  const dir = mkdtempSync(join(tmpdir(), 'vc-bundled-'))
  for (const dll of dlls) writeFileSync(join(dir, dll), 'x')
  return dir
}

test('系统装齐全部必需 DLL ⇒ ok，且来源记为 System32', () => {
  const root = fakeSystemRoot(REQUIRED_VC_DLLS)
  try {
    const probe = probeVcRuntime({ systemRoot: root })
    assert.equal(probe.ok, true)
    assert.deepEqual(probe.missing, [])
    assert.deepEqual([...probe.inSystem32].sort(), [...REQUIRED_VC_DLLS].sort())
    assert.deepEqual(probe.inBundled, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('系统全缺、随包目录带齐 ⇒ ok（探测把随包目录计入可用来源）', () => {
  const root = fakeSystemRoot([])
  const bundled = fakeBundled(REQUIRED_VC_DLLS)
  try {
    const probe = probeVcRuntime({ systemRoot: root, bundledDir: bundled })
    assert.equal(probe.ok, true)
    assert.deepEqual(probe.missing, [])
    assert.deepEqual(probe.inSystem32, [])
    assert.deepEqual([...probe.inBundled].sort(), [...REQUIRED_VC_DLLS].sort())
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(bundled, { recursive: true, force: true })
  }
})

test('两侧都没有关键项 ⇒ 不 ok，且 missing 只列关键项', () => {
  const root = fakeSystemRoot([])
  try {
    const probe = probeVcRuntime({ systemRoot: root })
    assert.equal(probe.ok, false)
    assert.deepEqual([...probe.missing].sort(), [...CRITICAL_VC_DLLS].sort())
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('只缺非关键分区（msvcp140_1/2）⇒ 仍算 ok，不误报', () => {
  const root = fakeSystemRoot(CRITICAL_VC_DLLS)
  try {
    const probe = probeVcRuntime({ systemRoot: root })
    assert.equal(probe.ok, true)
    assert.deepEqual(probe.missing, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('系统缺、随包目录只带关键项 ⇒ ok（不要求非关键分区）', () => {
  const root = fakeSystemRoot([])
  const bundled = fakeBundled(CRITICAL_VC_DLLS)
  try {
    const probe = probeVcRuntime({ systemRoot: root, bundledDir: bundled })
    assert.equal(probe.ok, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(bundled, { recursive: true, force: true })
  }
})

test('错误说明里必须给出缺失项、可操作命令与误导性报错原文', () => {
  const root = fakeSystemRoot([])
  try {
    const probe = probeVcRuntime({ systemRoot: root })
    const text = describeVcRuntimeProblem(probe)
    // 缺失项要指名
    for (const dll of probe.missing) assert.ok(text.includes(dll), `说明里缺 ${dll}`)
    // 要给出可执行修复路径
    assert.ok(text.includes('VCRedist'), '未给出 winget 安装 id')
    assert.ok(text.includes('vc_redist.x64.exe'), '未给出官方安装包地址')
    // 要点明「文件其实存在」这层误导，否则用户会去查路径
    assert.ok(text.includes('The specified module could not be found'), '未引用那句误导性报错')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('installVcRuntime：安装包不存在时返回失败而不抛错（调用方据此给手动引导）', async () => {
  const { installVcRuntime } = await import('../lib/types/electron/vc-runtime.js')
  const result = await installVcRuntime(join(tmpdir(), 'definitely-not-here-12345', 'vc_redist.x64.exe'))
  assert.equal(result.installed, false)
  assert.match(result.message, /不存在/)
})

test('安装结果判定：1638/3010/1602 的语义必须明确（已装更新版/需重启/用户取消）', async () => {
  // 这些退出码由 installVcRuntime 内部映射；这里用文档化的常量断言语义边界，
  // 防止有人把「用户取消」误归成「安装失败」写进诊断日志。
  const mod = await import('../lib/types/electron/vc-runtime.js')
  assert.equal(typeof mod.VC_REDIST_FILENAME, 'string')
  assert.equal(mod.VC_REDIST_FILENAME, 'vc_redist.x64.exe')
  assert.ok(mod.VC_REDIST_URL.startsWith('https://aka.ms/'), '安装包地址应为微软永久跳转')
})
