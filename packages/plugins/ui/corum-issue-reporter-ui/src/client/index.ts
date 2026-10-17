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
 *
 * ## connection 接线（本轮新增，形态照抄 corum-ollama / corum-ide-statusbar-ui）
 *
 * `apply` 里**建一次** `createGithubClient(connection)` 并作为 prop 交给面板——
 * 面板不自己造客户端（在组件内每次 render 新建会让 RPC 面每帧换一个对象）。
 * 服务依赖用两处声明表达：
 *   ① `package.json` 的 `dsh.client.inject`（**包名边**：`@deepseek-ai/dsh-client-connection`
 *      的 client bundle 必须先于本包 materialize / 参与 cordis 装配）；
 *   ② 本文件的 `export const inject = ['connection']`（**cordis 服务名**：connection
 *      就绪后才 apply）。
 * 两处缺一都会让 `ctx.get('connection')` 拿到未装配的服务（红线 4）。
 * @module corum-issue-reporter/client
 */

import { type Context as ClientContext } from '@deepseek-ai/cordis'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { IssueReporter } from './IssueReporter.tsx'
import { createGithubClient, type GithubConnection } from './github.ts'

/**
 * host 半边（`issueReporter`）的客户端调用层：面板要的 7 个方法都在这里，
 * 调用面本身零 UI、零状态（见 `./github.ts`）。
 */
export { createGithubClient } from './github.ts'
export type { GithubClient, GithubConnection, GithubRpcOutcome } from './github.ts'

/**
 * 运行时依赖的服务：`connection`（`connection.rpc.call('/api', …)` 的唯一入口）。
 * 与 `package.json` 的 `dsh.client.inject` 是**两件事**，两处都要写（见文件头注释）。
 */
export const inject: string[] = ['connection']

/** body 级挂载容器的类名（幂等复用与清理都认它）。 */
const ROOT_CLASS = 'corum-issue-reporter-root'

/**
 * Client plugin body: mount the floating entry into a body-level container.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // inject 已声明 connection ⇒ 这里拿到的是已装配的服务；窄化成本地能力接口
  // （红线 3：不为一个 RPC 面耦合官方实现包的类型）。
  const connection = ctx.get('connection') as GithubConnection | undefined
  const client = createGithubClient(connection)

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
    root.render(createElement(IssueReporter, { client }))

    return () => {
      root.unmount()
      host.remove()
    }
  }, 'corum-issue-reporter: floating entry')
}
