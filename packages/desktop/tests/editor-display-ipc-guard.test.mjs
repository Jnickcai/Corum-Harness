// 编辑器显示偏好的 IPC 守卫必须接受**本壳所有窗口**（主窗 + 浮窗），不是只认主窗。
//
// 为什么单独钉这条：编辑器槽位能被拖成浮窗（RegionCard 的脱出没有白名单），而同一个
// client bundle 在每个 Electron 窗口里都会加载。守卫只比主窗时，浮窗里读设置会抛错
// ⇒ 回落默认值；写设置同样抛错 ⇒ 用户每改一次就打一条 console.error，且不落盘
// （PR #116 审查发现，2026-10-22 修复）。这里用最小化的假窗口对象直接判定谓词语义，
// 不需要真的起 Electron（宿主测试跑在 node --test 下）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/electron/ipc.ts', import.meta.url), 'utf8')

/** 从源码里抽出 isOwnShellFrame 的窗口集合表达式，按同一语义复算。 */
function guardAccepts({ mainWindow, floatingWindows, sender, senderFrame, destroyed = false }) {
  const owners = [mainWindow, ...floatingWindows].filter(win => win !== null && !win.isDestroyed())
  return owners.some(win => sender === win.webContents && senderFrame === win.webContents.mainFrame)
}

const windowStub = (id) => {
  const mainFrame = { frameId: `${id}-main` }
  const webContents = { id, mainFrame }
  return { webContents, isDestroyed: () => false }
}

test('守卫的窗口集合覆盖主窗与全部浮窗（源码形态）', () => {
  // 源码级断言：集合必须同时包含 getWindow() 与 floatingWindows，缺任一个就复发。
  assert.match(source, /\[getWindow\(\), \.\.\.floatingWindows\.values\(\)\]/)
  // 且必须排除已销毁窗口，否则关窗后 sender 比对会炸在 getWebContents 上。
  assert.match(source, /!win\.isDestroyed\(\)/)
})

test('两个偏好 handler 都走该守卫，不再与主窗 webContents.id 直比', () => {
  // 用 `ipcMain.handle('…')` 定位真注册点：直接 indexOf 字符串会先命中注释。
  // 注意两个 handler 是**相邻**注册的，而 startup-animation-set 在文件更靠前处，
  // 不能拿它当右边界（位置顺序不是阅读顺序）。
  const at = (channel) => source.indexOf(`ipcMain.handle('${channel}'`)
  const getStart = at('corum:editor-display-get')
  const setStart = at('corum:editor-display-set')
  assert.ok(getStart > 0 && setStart > getStart, '未找到两个偏好 handler 的注册点')
  // 右边界取「下一个 ipcMain.handle」，避免依赖具体是哪个 channel。
  const nextHandler = source.indexOf('ipcMain.handle(', setStart + 1)
  const blocks = {
    get: source.slice(getStart, setStart),
    set: source.slice(setStart, nextHandler),
  }
  for (const [name, block] of Object.entries(blocks)) {
    assert.ok(block.includes('isOwnShellFrame(event)'), `corum:editor-display-${name} 未走 isOwnShellFrame`)
    assert.ok(
      !block.includes('getWindow()?.webContents.id'),
      `corum:editor-display-${name} 仍与主窗直比（浮窗会被误拒）`,
    )
  }
})

test('浮窗发起的读写被接受，主窗同样被接受', () => {
  const main = windowStub('main')
  const floating = windowStub('float-editor')
  const env = { mainWindow: main, floatingWindows: [floating] }
  assert.equal(guardAccepts({ ...env, sender: floating.webContents, senderFrame: floating.webContents.mainFrame }), true)
  assert.equal(guardAccepts({ ...env, sender: main.webContents, senderFrame: main.webContents.mainFrame }), true)
})

test('主窗已关（getWindow 为 null）但浮窗仍在时仍可读写', () => {
  const floating = windowStub('float-editor')
  assert.equal(
    guardAccepts({ mainWindow: null, floatingWindows: [floating], sender: floating.webContents, senderFrame: floating.webContents.mainFrame }),
    true,
  )
})

test('陌生窗口与子 frame 一律被拒', () => {
  const main = windowStub('main')
  const floating = windowStub('float-editor')
  const stranger = windowStub('stranger')
  const env = { mainWindow: main, floatingWindows: [floating] }
  assert.equal(guardAccepts({ ...env, sender: stranger.webContents, senderFrame: stranger.webContents.mainFrame }), false)
  // 同一窗口的 iframe：sender 相同但 senderFrame 不是 mainFrame。
  assert.equal(guardAccepts({ ...env, sender: floating.webContents, senderFrame: { frameId: 'iframe' } }), false)
})

test('已销毁窗口不参与比对', () => {
  const destroyed = { webContents: { id: 'dead', mainFrame: {} }, isDestroyed: () => true }
  assert.equal(
    guardAccepts({ mainWindow: null, floatingWindows: [destroyed], sender: destroyed.webContents, senderFrame: destroyed.webContents.mainFrame }),
    false,
  )
})
