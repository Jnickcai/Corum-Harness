/**
 * 窗口标题的品牌钉定（三平台）。
 *
 * ## 为什么需要这个模块
 *
 * Electron 的默认行为：页面 `<title>` 一变化就用它覆盖窗口标题
 * （`page-title-updated` 事件，默认动作 = `win.setTitle(页面的 title)`）。
 *
 * 基座前端 `@deepseek-ai/dsh-web-frontend` 的 `dist/index.html` 写死了
 * `<title>DeepSeek Harness</title>` —— 那是 npm 包产物，**不在本仓源码里**，
 * 无法直接改。后果：`new BrowserWindow({ title: '矩道' })` 只在 `loadURL()` 之前
 * 有效，页面一加载标题就被改写成「DeepSeek Harness」，于是：
 *
 * - macOS：Dock 悬停、Mission Control、⌘Tab 切换器、窗口菜单都显示错误品牌名；
 * - Windows/Linux：任务栏缩略图、Alt-Tab 同样读窗口标题（原生标题栏虽被
 *   `titleBarStyle: 'hidden'` 藏掉，这两个消费方仍读 `BrowserWindow.getTitle()`）。
 *
 * 所以三平台都要钉。
 *
 * ## 做法
 *
 * 监听**`webContents` 上的** `page-title-updated`（而不是 `win` 上的同名事件：
 * Electron 覆盖窗口标题的动作在 webContents 侧，在 `win` 上 `preventDefault()`
 * 拦不住），`preventDefault()` 掉默认动作并复位成品牌名。
 *
 * @module corum-desktop/electron/window-title
 */

import { app, type BrowserWindow } from 'electron'

/**
 * 窗口标题：中文「矩道」、英文「Corum」，按系统语言选（2026-08-28 改名）。
 *
 * 每次读取都问一次 `app.getLocale()`，不冻结在模块加载时——Electron 允许
 * locale 在 ready 之后才最终确定，模块顶层求值可能拿到 `en-US` 默认值。
 */
export function corumWindowTitle(): string {
  return app.getLocale().startsWith('zh') ? '矩道' : 'Corum'
}

/**
 * 把窗口标题钉成 corum 品牌名，不让页面 `<title>` 改写它。
 *
 * 幂等：同一个窗口重复调用只是多挂一个监听（每个监听都会把标题复位成同一个值，
 * 无副作用）；但仍建议每个窗口只调一次。
 *
 * @param win - 已创建的主窗口或浮窗。
 * @param title - 要钉的品牌名；省略时按系统语言取 {@link corumWindowTitle}。
 */
export function pinWindowTitle(win: BrowserWindow, title?: string): void {
  win.webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    win.setTitle(title ?? corumWindowTitle())
  })
}
