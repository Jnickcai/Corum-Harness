/**
 * 内置岗位与维度的机器化对账（2026-09-10 用户需求：岗位要有一个「全能/通用助手」，
 * 不能只限于编程）。
 *
 * 覆盖：
 *   1. 新增「通用」维度在**后端校验**与**UI 下拉**两处同步（漏一处 → 保存被静默丢弃
 *      或编辑器里选不到）；
 *   2. 内置岗位「全能助手」（`general-assistant`）存在且用 `dimension: '通用'`；
 *   3. 岗位 persona 的语言纪律由 `prompt-language.spec.ts` 覆盖（本 spec 不重复）；
 *   4. 内置 profile **不得携带开发者私网网关 provider**（2026-10-16 用户报障：产品内置的
 *      「指挥模式」把主/子 Agent 模型全钉在 `localhost` ⇒ 每个新用户第一次使用就
 *      `no adapter registered for provider "localhost"`）；
 *   5. 该缺陷在老安装里的残留由 `refreshFromSpec` 的定向清除负责（同批新增）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isValidAgentDimension } from '../src/profile.ts'
import { refreshFromSpec } from '../src/builtin-profiles.ts'

const AGENT_SRC = join(import.meta.dirname, '../src')
const UI_SRC = join(import.meta.dirname, '../../../../plugins/ui/corum-ide-ui/src/client/settings/sections/SettingsAgentPresetsSection.tsx')

describe('岗位维度「通用」— 后端与 UI 同步', () => {
  it('isValidAgentDimension 接受「通用」并继续拒绝未知值', () => {
    expect(isValidAgentDimension('通用')).toBe(true)
    for (const known of ['研发', '产品', '设计', '市场', '自媒体', '创作']) {
      expect(isValidAgentDimension(known)).toBe(true)
    }
    expect(isValidAgentDimension('不存在')).toBe(false)
  })

  it('AgentDimension 联合类型含「通用」', () => {
    const src = readFileSync(join(AGENT_SRC, 'profile.ts'), 'utf8')
    const union = src.match(/export type AgentDimension = ([^\n]+)/)?.[1] ?? ''
    expect(union).toContain("'通用'")
  })

  it('Agent 预设编辑器的维度选项含「通用」（否则编辑器里选不到）', () => {
    const src = readFileSync(UI_SRC, 'utf8')
    expect(src).toMatch(/AGENT_DIMENSIONS = \[[^\]]*'通用'/)
  })
})

describe('内置岗位「全能助手」', () => {
  const src = readFileSync(join(AGENT_SRC, 'builtin-profiles.ts'), 'utf8')

  it('存在 general-assistant 岗位，昵称/标题为全能助手 / 通用助手', () => {
    const block = src.slice(src.indexOf("id: 'general-assistant'"))
    expect(block).not.toBe('')
    const head = block.slice(0, 400)
    expect(head).toContain("nickname: '全能助手'")
    expect(head).toContain("title: '通用助手'")
  })

  it('使用通用维度 + 标准模式（不限编程，能力面与标准模式同级）', () => {
    const head = src.slice(src.indexOf("id: 'general-assistant'")).slice(0, 400)
    expect(head).toContain("dimension: '通用'")
    expect(head).toContain("baseMode: 'standard'")
  })

  it('persona 覆盖编程之外的领域（写作/研究/规划/数据/翻译/编码）', () => {
    const head = src.slice(src.indexOf("id: 'general-assistant'")).slice(0, 900)
    for (const domain of ['writing', 'research', 'planning', 'data work', 'translation', 'coding']) {
      expect(head, domain).toContain(domain)
    }
  })
})

/**
 * 五个「模式入口」Agent 的命名与继承对账（2026-09-13 用户定稿命名）。
 *
 * 由来：2026-09-12 定调「dsh 官方五模式不再直接选中，只作继承模板」，每个模式配一个
 * 内置 Agent 作为可选中/可配置入口；2026-09-13 用户把五个入口的**名字**定稿为
 * 「标准模式 / 指挥模式 / PTC 模式 / 极简模式 / 创造模式」。
 *
 * 为什么用源码扫描而不是 import：内置角色表是「服务启动时幂等播种」的静态表，
 * 名字与 baseMode 的对应关系正是本决策的内容，钉在源码层最直接（同 spec 上文对
 * `general-assistant` 的做法）。改动这五个入口的名字或继承关系会让本用例变红——
 * 那正是我们要的：这是用户拍板过的命名，不能被顺手改掉或漏改。
 */
describe('五个模式入口 Agent（2026-09-13 命名定稿）', () => {
  const src = readFileSync(join(AGENT_SRC, 'builtin-profiles.ts'), 'utf8')

  /** 取某个 id 定义块的前 600 字（够覆盖 nickname/title/dimension/baseMode）。 */
  const blockOf = (id: string): string => {
    const at = src.indexOf(`id: '${id}'`)
    expect(at, `内置角色 ${id} 不存在`).toBeGreaterThan(-1)
    return src.slice(at, at + 600)
  }

  it.each([
    ['standard-mode', '标准模式', 'standard'],
    ['conductor-lead', '指挥模式', 'conductor'],
    ['ptc-assistant', 'PTC 模式', 'ptc'],
    ['minimal-assistant', '极简模式', 'minimal'],
    ['preset-author', '创造模式', 'cordis'],
  ])('%s 的昵称是「%s」且 baseMode 是 %s', (id, nickname, baseMode) => {
    const block = blockOf(id)
    expect(block).toContain(`nickname: '${nickname}'`)
    expect(block).toContain(`baseMode: '${baseMode}'`)
  })

  it('五档齐备：每个模式都有且只有一个入口（漏一个用户就没法选到那个模式）', () => {
    const modes = ['standard', 'conductor', 'ptc', 'minimal', 'cordis']
    const entryIds = ['standard-mode', 'conductor-lead', 'ptc-assistant', 'minimal-assistant', 'preset-author']
    for (const [i, mode] of modes.entries()) {
      expect(blockOf(entryIds[i])).toContain(`baseMode: '${mode}'`)
    }
  })

  it('入口的 persona 不含 CJK（语言纪律，同 prompt-language.spec.ts 的口径）', () => {
    for (const id of ['standard-mode', 'conductor-lead', 'ptc-assistant', 'minimal-assistant', 'preset-author']) {
      const block = blockOf(id)
      const prompt = block.match(/prompt:\s*'([^']*)'/)?.[1] ?? ''
      // 允许拼接式 prompt（conductor-lead 是多段 + 连接）：取不到单引号字面量就跳过该条。
      if (prompt === '') continue
      expect(/[\u4e00-\u9fff]/.test(prompt), `${id} 的 prompt 含中文`).toBe(false)
    }
  })
})

/**
 * 幂等刷新：**按字段来源**——spec 演进要落地，用户改过的不许被覆盖（2026-09-14）。
 *
 * 两个契约必须同时成立，且它们曾经互相冲突：
 *  ① 2026-09-13 修正的静默失效：「指挥者 → 指挥模式」这类**只改昵称**的演进，
 *     对既有安装必须能落地（否则只有全新 home 拿到新名字）；
 *  ② 2026-09-14 用户拍板原则：「手动改的模型配置属于用户数据，**不应该在程序升级后
 *     被覆盖**」——而旧实现把 nickname/title/dimension/baseMode/prompt/model/
 *     subagentModel/researchModel **八个字段按 spec 无条件覆写**（其注释却写着
 *     「保留用户的模型/能力配置」，代码与注释相反），每次启动都静默回滚用户修改。
 *
 * 修法：`AgentProfile.specBaseline` 记住上一次 spec 写入的值。判据为
 * **当前值 === 基线值 ⇒ 用户没改过 ⇒ 随 spec 刷新；不等 ⇒ 用户改过 ⇒ 保留**。
 *
 * 本用例改为**行为断言**（旧版是对源码做字符串匹配 `existing.X !== spec.X`，那会把
 * 实现细节钉死、重构即误报，也无法验证「用户改过就保留」这一半）。
 */
describe('内置角色的幂等刷新：spec 演进落地 + 用户数据不被覆盖', () => {
  it('用户没改过的字段：spec 改名会落地（2026-09-13 那条契约）', () => {
    const baseline = { nickname: '指挥者', title: '编排指挥', dimension: '研发', baseMode: 'conductor', prompt: 'P1' }
    const existing = { id: 'x', trust: 'system', specBaseline: baseline, nickname: '指挥者', title: '编排指挥', dimension: '研发', baseMode: 'conductor', prompt: 'P1' } as never
    const spec = { id: 'x', nickname: '指挥模式', title: '编排指挥', dimension: '研发', baseMode: 'conductor', prompt: 'P1' } as never
    const r = refreshFromSpec(existing, spec)
    expect(r.changed).toBe(true)
    expect((r.next as { nickname?: string }).nickname).toBe('指挥模式')
    expect(r.baseline.nickname).toBe('指挥模式')
  })

  it('用户改过的字段：spec 不得覆盖（2026-09-14 那条契约）', () => {
    // 基线是 spec 当初写的 deepseek-v4-flash；用户把它改成了本地模型。
    const baseline = { nickname: 'Task 助理', model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }
    const existing = { id: 'task', trust: 'system', specBaseline: baseline, nickname: 'Task 助理', model: { provider: 'localhost', model: 'deepseek-v4.1-flash' } } as never
    const spec = { id: 'task', nickname: 'Task 助理', model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } as never
    const r = refreshFromSpec(existing, spec)
    expect(r.changed).toBe(false)
    expect((r.next as { model?: { model?: string } }).model?.model).toBe('deepseek-v4.1-flash')
  })

  it('老安装（无基线）：首次只播种基线、不改任何现值', () => {
    const existing = { id: 'x', trust: 'system', nickname: '我改过的名字', model: { provider: 'localhost', model: 'mine' } } as never
    const spec = { id: 'x', nickname: 'spec 名字', model: { provider: 'deepseek-official', model: 'spec 模型' } } as never
    const r = refreshFromSpec(existing, spec)
    // 现值一个都不许动（播种不改值）……
    expect((r.next as { nickname?: string }).nickname).toBe('我改过的名字')
    expect((r.next as { model?: { model?: string } }).model?.model).toBe('mine')
    // ……但基线要落盘（= 现值），于是「今后」的修改才能被识别为「用户改过」。
    expect(r.changed).toBe(true)
    expect(r.baseline.nickname).toBe('我改过的名字')
    expect((r.baseline.model as { model?: string }).model).toBe('mine')
  })

  it('播种后再改 spec：未被用户改过的字段随 spec 刷新', () => {
    // 第一次：播种（基线=现值=spec 值）
    const seed = refreshFromSpec(
      { id: 'x', trust: 'system', nickname: '旧名' } as never,
      { id: 'x', nickname: '旧名' } as never,
    )
    // 第二次：spec 改名且用户没动过 ⇒ 必须落地（2026-09-13 那条契约）
    const after = refreshFromSpec(
      { id: 'x', trust: 'system', nickname: '旧名', specBaseline: seed.baseline } as never,
      { id: 'x', nickname: '新名' } as never,
    )
    expect(after.changed).toBe(true)
    expect((after.next as { nickname?: string }).nickname).toBe('新名')
  })

  it('spec 不拥有的字段（skills/mcp/记忆策略）永不被刷新触碰', () => {
    const existing = { id: 'x', trust: 'system', specBaseline: {}, skills: [{ name: 's', versionId: '' }], mcpServers: ['a'], memoryPolicy: { scope: 'agent' } } as never
    const spec = { id: 'x', nickname: 'n' } as never
    const r = refreshFromSpec(existing, spec)
    const next = r.next as { skills?: unknown; mcpServers?: unknown; memoryPolicy?: unknown }
    expect(next.skills).toEqual([{ name: 's', versionId: '' }])
    expect(next.mcpServers).toEqual(['a'])
    expect(next.memoryPolicy).toEqual({ scope: 'agent' })
  })
})

/**
 * 回归守卫：内置 profile **不得指向开发者私网网关**（2026-10-16 用户报障）。
 *
 * 现象：产品内置的「指挥模式」（`conductor-lead`）把主 Agent / 写子 Agent / 研究子 Agent
 * 三档模型全钉在 `provider: 'localhost'` —— 那是**项目开发者本机**的本地网关 provider，
 * 普通用户机器上根本不存在，于是新用户第一个指挥会话主/子 Agent 双双
 * `no adapter registered for provider "localhost"`。同源的前一次是 2026-09-26 的
 * `kimi-k3-1` 报障（见 builtin-profiles.ts 里 conductor-lead 的历史注释）。
 *
 * 为什么用源码扫描：内置角色表 `BUILTIN_ROLES` 是模块私有常量，且「不许钉私网网关」
 * 正是这张静态表的内容纪律（同本 spec 对五个模式入口的命名对账做法）。
 *
 * `pi-ai` **不在**判据内：那是第三方适配器注册的 provider 名，用户自己的合法配置就走它；
 * 私网判据只有 `localhost`。
 */
describe('内置 profile 不得携带开发者私网网关 provider（2026-10-16 用户报障）', () => {
  const src = readFileSync(join(AGENT_SRC, 'builtin-profiles.ts'), 'utf8')
  /**
   * 只取 `BUILTIN_ROLES` 数组字面量本身（到行首的 `]` 为止）。
   *
   * 切片到文件尾会把 `DEV_PRIVATE_GATEWAY_RESIDUES` 那张「我们下发过的残留路由」表
   *（里面**故意写着** `provider: 'localhost'`）一起扫进来 ⇒ 假红；而取太窄（比如只取第一个
   * 角色块）⇒ 假绿。
   */
  const region = src.match(/const BUILTIN_ROLES[^\n]*= \[([\s\S]*?)\n\]/)?.[1] ?? ''
  /**
   * 只扫**代码行**（去掉行注释）：conductor-lead 的历史注释里就写着反面教材字样
   * `provider: 'localhost'`，直接扫全文会把这句说明当成缺陷 ⇒ 假红。
   */
  const code = region.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
  const providers = [...code.matchAll(/provider:\s*'([^']*)'/g)].map(m => m[1])

  it('取到的是完整的 BUILTIN_ROLES 区域（否则下面会退化成空扫假绿）', () => {
    expect(code, 'BUILTIN_ROLES 区域没取到').not.toBe('')
    expect(code).toContain("id: 'conductor-lead'")            // 本次报障的那个角色
    expect((code.match(/\n\s*id: '/g) ?? []).length).toBeGreaterThanOrEqual(26)
  })

  it('没有任何内置角色把 provider 钉在 localhost（用户机器上没有这个 provider）', () => {
    expect(providers.filter(p => p === 'localhost')).toEqual([])
  })

  it('守卫本身有效：样例里钉回 localhost，同一套扫描能抓到（防判据失效后仍显示绿）', () => {
    const sample = [
      'const BUILTIN_ROLES: readonly BuiltinRoleSpec[] = [',
      '  {',
      "    id: 'x',",
      "    model: { provider: 'localhost', model: 'm' },",
      '  },',
      ']',
    ].join('\n')
    const sampleRegion = sample.match(/const BUILTIN_ROLES[^\n]*= \[([\s\S]*?)\n\]/)?.[1] ?? ''
    const sampleProviders = [...sampleRegion.matchAll(/provider:\s*'([^']*)'/g)].map(m => m[1])
    expect(sampleProviders).toEqual(['localhost'])
  })

  it('conductor-lead 不声明任何模型字段（⇒ 主 Agent 落全局默认、子 Agent 继承会话路由）', () => {
    const at = code.indexOf("id: 'conductor-lead'")
    expect(at).toBeGreaterThan(-1)
    // 角色块 = 该 id 到下一个角色的 id（数组末尾则到区域末尾）
    const rest = code.slice(at)
    const end = rest.indexOf("\n    id: '", 1)
    const block = end === -1 ? rest : rest.slice(0, end)
    for (const field of ['model', 'subagentModel', 'researchModel']) {
      expect(block, `${field} 仍被声明`).not.toMatch(new RegExp(`(^|\\n)\\s*${field}:`))
    }
  })
})

/**
 * 开发者私网网关残留的**定向清除**（2026-10-16）。
 *
 * 为什么必须有：把这些模型字段从 spec 里删掉后，`refreshFromSpec` 的常规语义是
 * 「spec 未给值 ⇒ 不动现值」⇒ **老安装里残留的 localhost 路由永远不会被清掉**，缺陷在老
 * 用户身上不消失（他那台机器上每次新建指挥会话照旧报 `no adapter registered for
 * provider "localhost"`，还得手动去设置里改）。
 *
 * 判据与落点（2026-10-16 指挥者裁定）：
 * · **精确配对**：只有 provider 与 model 都等于我们当年下发的那个组合才算残留
 *   （`reasoningEffort` 不参与判定）；只匹配 provider 会误删用户自己叫 `localhost` 的网关。
 * · `subagentModel` / `researchModel` ⇒ **删除**键（absent = 不覆盖 ⇒ 继承会话路由）。
 * · `model` ⇒ **替换成产品默认** `deepseek-official/deepseek-v4-flash`，不能删成 absent
 *   （创建路径给全新安装写的就是这个显式值；absent 的语义是「继承全局默认」，两者不等价）。
 */
describe('开发者私网网关残留的定向清除（2026-10-16）', () => {
  /** 修好后的 conductor-lead spec：只保留非模型字段（模型钉已删）。 */
  const fixedSpec = { id: 'conductor-lead', nickname: '指挥模式', title: '编排指挥', dimension: '研发', baseMode: 'conductor', prompt: 'P' } as never
  const PRODUCT_DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  const gateway = (model: string, reasoningEffort = 'high'): { provider: string; model: string; reasoningEffort: string } =>
    ({ provider: 'localhost', model, reasoningEffort })

  it('老 profile（带基线）：两个子 Agent 残留被删键、主 model 残留被换成产品默认', () => {
    const existing = {
      id: 'conductor-lead',
      trust: 'system',
      model: gateway('kimi-k3'),
      subagentModel: gateway('deepseek-v4.1-flash'),
      researchModel: gateway('glm-5.3-flash'),
      specBaseline: {
        nickname: '指挥模式',
        model: gateway('kimi-k3'),
        subagentModel: gateway('deepseek-v4.1-flash'),
        researchModel: gateway('glm-5.3-flash'),
      },
    } as never
    const r = refreshFromSpec(existing, fixedSpec)
    const next = r.next as Record<string, unknown>
    // 键要**真的不存在**（不是设成 undefined —— 那样落盘后仍是键）
    expect('subagentModel' in next).toBe(false)
    expect('researchModel' in next).toBe(false)
    // 主 Agent 模型不能删成 absent：必须落到与全新安装一致的产品默认
    expect(next.model).toEqual(PRODUCT_DEFAULT)
    expect(r.changed).toBe(true)                  // 动了东西 ⇒ 必须落盘
    expect(r.baseline.subagentModel).toBeNull()   // spec 不再拥有它，别把被清的值记成基线
    expect(r.baseline.researchModel).toBeNull()
    expect(r.baseline.model).toBeNull()
  })

  it('老安装（无基线）：播种时同样清（否则缺陷留痕最久的正是那批用户）', () => {
    const existing = { id: 'conductor-lead', trust: 'system', nickname: '指挥模式', model: gateway('kimi-k3'), researchModel: gateway('glm-5.3-flash') } as never
    const r = refreshFromSpec(existing, fixedSpec)
    const next = r.next as Record<string, unknown>
    expect(next.model).toEqual(PRODUCT_DEFAULT)
    expect('researchModel' in next).toBe(false)
  })

  it('负向守卫：用户**自己**的本地网关（localhost + 别的模型名）原样不动', () => {
    const mine = { provider: 'localhost', model: 'my-local-model' }
    const myChild = { provider: 'localhost', model: 'my-child-model' }
    const existing = { id: 'x', trust: 'system', nickname: 'n', specBaseline: {}, model: mine, subagentModel: myChild, researchModel: myChild } as never
    const r = refreshFromSpec(existing, { id: 'x', nickname: 'n' } as never)
    const next = r.next as Record<string, unknown>
    expect(next.model).toEqual(mine)
    expect(next.subagentModel).toEqual(myChild)
    expect(next.researchModel).toEqual(myChild)
    expect(r.changed).toBe(false)                 // 无副作用：连落盘都不需要
  })

  it('用户自选的其它 provider（deepseek-official / pi-ai）一律不动', () => {
    const mine = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    const piAi = { provider: 'pi-ai', model: 'glm-5.3' }
    const existing = { id: 'x', trust: 'system', nickname: 'n', specBaseline: {}, subagentModel: mine, researchModel: piAi } as never
    const r = refreshFromSpec(existing, { id: 'x', nickname: 'n' } as never)
    const next = r.next as { subagentModel?: unknown; researchModel?: unknown }
    expect(next.subagentModel).toEqual(mine)
    expect(next.researchModel).toEqual(piAi)
    expect(r.changed).toBe(false)
  })

  it('reasoningEffort 不参与判定：用户只调过档位也照样清', () => {
    const existing = { id: 'conductor-lead', trust: 'system', nickname: '指挥模式', model: gateway('kimi-k3', 'max') } as never
    const r = refreshFromSpec(existing, fixedSpec)
    expect((r.next as Record<string, unknown>).model).toEqual(PRODUCT_DEFAULT)
  })

  it('spec 仍声明该键时一律不清除（常规刷新语义照旧生效）', () => {
    const declared = { provider: 'localhost', model: 'kimi-k3' }
    const spec = { id: 'x', nickname: 'n', model: declared, subagentModel: { provider: 'localhost', model: 'm' } } as never
    const existing = { id: 'x', trust: 'system', nickname: 'n', specBaseline: {}, model: { ...declared }, subagentModel: { provider: 'localhost', model: 'm' } } as never
    const r = refreshFromSpec(existing, spec)
    const next = r.next as Record<string, unknown>
    expect(next.model).toEqual(declared)
    expect(next.subagentModel).toEqual({ provider: 'localhost', model: 'm' })
  })
})
