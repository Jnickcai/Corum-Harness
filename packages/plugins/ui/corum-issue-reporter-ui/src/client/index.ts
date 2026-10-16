/**
 * @corum/corum-issue-reporter-ui client half —— 悬浮 Issue 提交入口。
 *
 * **不走 slot 注册**：这颗入口不属于任何网格区域，它是 body 级浮层（与通知 bell
 * 同一档心智）——挂进某个槽会被那个区域的 overflow/合成层裁掉，也会随区域隐藏
 * 一起消失。所以这里自建一个 body 级容器 + `createRoot`，把整块 UI 交给 React。
 *
 * 浮窗（`?floating=<slotKey>`）**不挂**：与通知 bell 的 `direct` 档同理——浮窗是
 * 一个随时会被关掉的小窗口，在其上再立一个提交入口只会和主窗那颗打架（两处都是
 * 同一份 localStorage 位置与草稿，点哪颗都行反而让人困惑）。
 * @module corum-issue-reporter/client
 */

import { type Context as ClientContext } from '@deepseek-ai/cordis'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { IssueReporter } from './IssueReporter.tsx'

/** Required services (none — 本插件只用 React 与 window 上的桌面桥). */
export const inject: string[] = []

/** body 级挂载容器的类名（幂等复用与清理都认它）。 */
const ROOT_CLASS = 'corum-issue-reporter-root'

/**
 * Client plugin body: mount the floating entry into a body-level container.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    // 浮窗不挂：判据与 window-role.ts 的 isFloatingWindow 同一 URL 契约。
    if (new URLSearchParams(location.search).has('floating')) return () => {}

    // 幂等：已存在同名容器就复用它（HMR / 重复 apply 时不能叠出两个 root 与两个按钮）。
    const existing = document.querySelector(`.${ROOT_CLASS}`)
    const host = existing instanceof HTMLDivElement ? existing : document.createElement('div')
    if (existing === null) {
      host.className = ROOT_CLASS
      document.body.appendChild(host)
    }
    const root: Root = createRoot(host)
    root.render(createElement(IssueReporter))

    return () => {
      root.unmount()
      host.remove()
    }
  }, 'corum-issue-reporter: floating entry')
}
