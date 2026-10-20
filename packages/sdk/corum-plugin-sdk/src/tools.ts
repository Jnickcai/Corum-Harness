/**
 * 给 Agent 注入工具 —— 第三方插件**最有意义**的能力面。
 *
 * ## 为什么这是「有意义」的分水岭
 *
 * 一个只会画面板的插件是装饰；能提供工具，Agent 才会真的用它干活 —— 这也是用户
 * 2026-10-21 的原话（「插件要能提供工具注入到 Agent 使用，这样才有意义」）。
 *
 * ## 路径（不发明新机制）
 *
 * 官方 `@deepseek-ai/dsh-tools` 的 `defineTool(...)` 产出定义，插件的 `apply` 里
 * `ctx.tools.register(definition)` 注册并拿到 disposer。本模块只做两件事：
 * ① 把 `defineTool` 与类型从 SDK 转发出去（第三方只依赖 1 个 SDK）；
 * ② `registerAgentTool()` 一个薄封装 —— 把「注册失败要说清是哪个工具」这点常识收进来。
 *
 * 注意：`ctx.tools` 是**宿主服务**；插件必须在 `apply` 的 `inject` 里声明 `tools`
 * （cordis 的属性访问在未 inject 时会抛，见红线 4）。
 *
 * @module @corum/plugin-sdk/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

export { defineTool }
export type { ToolDefinition }

/** 工具注册面（`ctx.tools` 的最小能力面）。 */
export interface ToolsFace {
  register: (definition: ToolDefinition) => () => void
}

/**
 * 定义一条工具（`defineTool` 的类型化薄封装）。
 *
 * ```ts
 * export const myTool = defineAgentTool({
 *   name: 'my_plugin_lookup',
 *   description: 'Look something up for the Agent.',
 *   parameters: { query: { type: 'string', description: 'What to look up.' } },
 *   output: { schema: { type: 'string' }, render: (_a, text) => [{ type: 'text', text }] },
 *   async execute(args) { return `result for ${args.query}` },
 * })
 * ```
 */
export const defineAgentTool: typeof defineTool = defineTool

/** 工具名约束（DeepSeek wire 契约：≤64 字符、`[A-Za-z0-9_-]`）。 */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * 注册一条工具到 Agent 的工具面。
 *
 * 注册失败时抛出**指名道姓**的错误（工具名 + 原因）—— 工具是模型能直接看到的东西，
 * 静默失败会让插件作者以为「我注册了」，实际 Agent 从来没用过它。
 *
 * ⚠️ **时序**：工具面在每一回合开头就被快照，所以注册必须在 `apply(ctx)` 里**同步**完成
 * （`ctx.effect(...)` 会立即执行），不要 `await` 网络/IO 之后再注册 —— 那会导致
 * 「第一回合没工具、第二回合才有」（本仓 MCP 代理踩过同样的坑）。
 *
 * @param tools - `ctx.tools`（插件需 `inject: ['tools']`）。
 * @param definition - `defineAgentTool(...)` 的产物。
 * @returns disposer（建议挂进 `ctx.effect`，插件卸载时工具随之消失）。
 */
export function registerAgentTool(tools: ToolsFace, definition: ToolDefinition): () => void {
  const name = (definition as { name?: string }).name ?? '(unnamed)'
  // 名字先自己判：官方 registry 只校验结构，不校验 wire 命名契约；而名字越界
  // （>64 字符或含非法字符）在**模型侧**才会炸，报错离注册点很远。
  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new Error(`registerAgentTool: 工具名 ${JSON.stringify(name)} 不合规（需 ≤64 字符且仅 [A-Za-z0-9_-]）`)
  }
  if (tools === undefined || typeof tools.register !== 'function') {
    throw new Error(`registerAgentTool: ctx.tools 不可用（插件是否在 inject 里声明了 'tools'？工具 ${name}）`)
  }
  try {
    return tools.register(definition)
  } catch (error) {
    throw new Error(`registerAgentTool: 注册工具 ${name} 失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
