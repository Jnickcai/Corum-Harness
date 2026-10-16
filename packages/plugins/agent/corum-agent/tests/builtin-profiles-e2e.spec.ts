/**
 * 内置 profile 幂等刷新的**端到端**验证：结果真的落到盘上（2026-10-16）。
 *
 * 为什么单独立一条（只有单元级 `refreshFromSpec` 不够）：缺陷现场是用户家目录里那份
 * `~/.corum/.agent-presets/conductor-lead/agent.json` ——「算出来的 next 对」与「盘上真的变
 * 干净了」是两件事，中间还隔着 `ensureBuiltinRoleProfiles` → `saveProfile`（读改写 + version
 * 自增）。本 spec 断言的是**重新读盘**后的文件，不是内存对象。
 *
 * 夹具 = 用户真实文件（`C:\Users\Administrator\.corum\.agent-presets\conductor-lead\agent.json`，
 * 2026-10-16 现场）的**逐字副本**：
 *   · `model: localhost/kimi-k3`、`researchModel: localhost/glm-5.3-flash`（含 baseline 里的
 *     `subagentModel: localhost/deepseek-v4.1-flash`）= 我们下发的残留；
 *   · `subagentModel: deepseek-official/deepseek-flash` = **用户自己答弹框改的**，必须原样保留。
 *
 * 全程在 `mkdtemp` 出来的临时 home 里跑（`CORUM_HOME` 指向它）——**绝不触碰真实 home**。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureBuiltinRoleProfiles } from '../src/builtin-profiles.ts'

/** 用户真实 `agent.json` 的逐字副本（`String.raw` 保持 JSON 里的 `\n` 转义不被 JS 解释）。 */
const REAL_AGENT_JSON = String.raw`{
  "id": "conductor-lead",
  "nickname": "指挥模式",
  "title": "编排指挥",
  "dimension": "研发",
  "baseMode": "conductor",
  "prompt": "Your role is the Conductor: own the technical judgement for the user's goal — investigate it yourself, decide how it must be done, delegate the production, then verify the result with your own eyes. Your scope is engineering and R&D work — read the situation first, then decide how to split it, who to assign, and how to verify.\n\nYour value is judgement: split well (clear, independent task boundaries), assign well (who fits best, what input they need, what they must deliver — with your chosen approach spelled out in the brief, not just the goal), and verify well (open the changed file and read the actual diff; judge by the original goal, never by a child agent's self-report).",
  "model": {
    "provider": "localhost",
    "model": "kimi-k3",
    "reasoningEffort": "high"
  },
  "subagentModel": {
    "provider": "deepseek-official",
    "model": "deepseek-flash"
  },
  "researchModel": {
    "provider": "localhost",
    "model": "glm-5.3-flash",
    "reasoningEffort": "high"
  },
  "avatar": "corumapp://app/assets/avatars/conductor-lead.png",
  "skills": [],
  "mcpServers": [],
  "terminal": {
    "mode": "sandbox"
  },
  "memoryPolicy": {
    "scope": "agent"
  },
  "version": 3,
  "trust": "system",
  "specBaseline": {
    "nickname": "指挥模式",
    "title": "编排指挥",
    "dimension": "研发",
    "baseMode": "conductor",
    "prompt": "Your role is the Conductor: own the technical judgement for the user's goal — investigate it yourself, decide how it must be done, delegate the production, then verify the result with your own eyes. Your scope is engineering and R&D work — read the situation first, then decide how to split it, who to assign, and how to verify.\n\nYour value is judgement: split well (clear, independent task boundaries), assign well (who fits best, what input they need, what they must deliver — with your chosen approach spelled out in the brief, not just the goal), and verify well (open the changed file and read the actual diff; judge by the original goal, never by a child agent's self-report).",
    "model": {
      "provider": "localhost",
      "model": "kimi-k3",
      "reasoningEffort": "high"
    },
    "subagentModel": {
      "provider": "localhost",
      "model": "deepseek-v4.1-flash",
      "reasoningEffort": "high"
    },
    "researchModel": {
      "provider": "localhost",
      "model": "glm-5.3-flash",
      "reasoningEffort": "high"
    },
    "executionTools": null,
    "parallelWork": null,
    "avatar": "corumapp://app/assets/avatars/conductor-lead.png"
  }
}
`

const PRODUCT_DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
/** 用户自己改的（弹框选的）子 Agent 路由 —— 必须原样保留。 */
const USER_SUBAGENT_ROUTE = { provider: 'deepseek-official', model: 'deepseek-flash' }

let home: string
const prevCorumHome = process.env.CORUM_HOME

/** 临时 home 里那份 conductor-lead agent.json 的路径。 */
const agentJsonPath = (): string => join(home, '.agent-presets', 'conductor-lead', 'agent.json')
/** 重新读盘（不是内存对象）。 */
const readAgentJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(agentJsonPath(), 'utf8')) as Record<string, unknown>

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'corum-bp-e2e-'))
  process.env.CORUM_HOME = home
  mkdirSync(join(home, '.agent-presets', 'conductor-lead'), { recursive: true })
  writeFileSync(agentJsonPath(), REAL_AGENT_JSON)
})

afterEach(() => {
  if (prevCorumHome === undefined) delete process.env.CORUM_HOME
  else process.env.CORUM_HOME = prevCorumHome
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('内置 profile 幂等刷新——端到端落盘（2026-10-16 用户报障的现场）', () => {
  it('夹具就是缺陷现场（否则下面的断言等于没测到东西）', () => {
    const before = readAgentJson()
    expect(before.model).toEqual({ provider: 'localhost', model: 'kimi-k3', reasoningEffort: 'high' })
    expect(before.researchModel).toEqual({ provider: 'localhost', model: 'glm-5.3-flash', reasoningEffort: 'high' })
    expect(before.subagentModel).toEqual(USER_SUBAGENT_ROUTE)
  })

  it('跑一次后重新读盘：model 换成产品默认、两个残留键消失、用户自选子 Agent 路由保留', () => {
    const versionBefore = readAgentJson().version
    ensureBuiltinRoleProfiles()
    const after = readAgentJson()

    // 残留：主 Agent 模型换成产品默认（不是 absent —— 要与全新安装的创建兜底一致）
    expect(after.model).toEqual(PRODUCT_DEFAULT)
    // 残留：研究子 Agent 键被删除（absent = 不覆盖 ⇒ 继承会话路由）
    expect('researchModel' in after).toBe(false)
    // 用户数据：他自己改的子 Agent 路由原样保留（spec 已不声明该键 ⇒ 刷新不碰）
    expect(after.subagentModel).toEqual(USER_SUBAGENT_ROUTE)
    // 确实写过盘：saveProfile 会把 version 自增
    expect(after.version as number).toBeGreaterThan(versionBefore as number)

    // 正对照：同一次调用确实把整套内置角色都播种了（不是"什么都没跑"）
    expect(JSON.parse(readFileSync(join(home, '.agent-presets', 'standard-mode', 'agent.json'), 'utf8'))).toBeDefined()
  })

  it('再跑一次：幂等——盘上不再发生写入（mtime 与 version 都不动）', () => {
    ensureBuiltinRoleProfiles()          // 第一次：把残留清干净
    const frozen = new Date('2000-01-01T00:00:00Z')
    utimesSync(agentJsonPath(), frozen, frozen)   // 把 mtime 钉到 2000 年
    const contentBefore = readFileSync(agentJsonPath(), 'utf8')
    const versionBefore = readAgentJson().version

    ensureBuiltinRoleProfiles()          // 第二次：不应再写

    // 若真发生写入，mtime 会从 2000 年跳到"现在"（误差容忍 2s 只为文件系统时间戳精度）
    expect(Math.abs(statSync(agentJsonPath()).mtimeMs - frozen.getTime())).toBeLessThan(2000)
    expect(readFileSync(agentJsonPath(), 'utf8')).toBe(contentBefore)
    expect(readAgentJson().version).toBe(versionBefore)
  })
})
