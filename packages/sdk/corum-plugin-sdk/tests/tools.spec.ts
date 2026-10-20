import { describe, expect, it } from 'vitest'
import { registerAgentTool } from '../src/tools.ts'

/** 最小可注册定义（register 的校验在宿主侧，这里只测我们的封装）。 */
const definition = (name: string) => ({ name, description: 'x', parameters: {}, output: { schema: { type: 'string' }, render: () => [] }, execute: async () => 'ok' })

describe('registerAgentTool', () => {
  it('正常注册：把定义交给 ctx.tools.register 并返回 disposer', () => {
    let received: unknown
    const dispose = () => undefined
    const tools = { register: (def: unknown) => { received = def; return dispose } }
    const def = definition('demo_session_report')
    expect(registerAgentTool(tools as never, def as never)).toBe(dispose)
    expect(received).toBe(def)
  })

  it('工具名不合 wire 契约 ⇒ 立刻抛（不等到模型侧才炸）', () => {
    const tools = { register: () => () => undefined }
    for (const bad of ['', 'has space', 'a'.repeat(65), '中文名', 'dot.name']) {
      expect(() => registerAgentTool(tools as never, definition(bad) as never), `名字 ${bad} 应被拒`).toThrow(/不合规/)
    }
    expect(() => registerAgentTool(tools as never, definition('ok_name-1') as never)).not.toThrow()
  })

  it('ctx.tools 不可用 ⇒ 报错并点名工具（提示 inject tools）', () => {
    expect(() => registerAgentTool(undefined as never, definition('x_tool') as never)).toThrow(/inject/)
  })

  it('register 抛错 ⇒ 包成「注册工具 X 失败」上下文', () => {
    const tools = { register: () => { throw new Error('boom') } }
    expect(() => registerAgentTool(tools as never, definition('x_tool') as never)).toThrow(/注册工具 x_tool 失败：boom/)
  })
})
