/**
 * `ask_user_question` 行的宽容解析回归（2026-10-21，会话 `corum-task-617b6402`）。
 *
 * 现场：模型一次发出四个并行提问，参数里的键被写坏（`"multi_select true,":false`、
 * `"options[{":":`）。官方行**严格**解析（任一题缺 id/question 即整组判 null），于是
 * 回落到通用工具行、把整段 JSON 当摘要显示——用户报的就是「提问卡片展示异常」。
 *
 * 本文件钉住的判据：**坏键不能把整行打回原始 JSON**。能读出的题干必须留下；
 * 一个题干/选项都读不出时才允许降级（`null` → 渲染层给「参数不完整」壳）。
 */
import { describe, expect, it } from 'vitest'
import { answeredCount, askQuestionModel, parseAskQuestions, resultText } from '../src/client/toolviews/ask-question.ts'

/** 现场原样参数（第一题完整、其余三题题干在但键被写坏）。 */
const CORRUPTED = '{"questions":[{"header":"执行深度","id":"scope","question":"文档治理要做到哪个深度？（docs/ 不在 git 里、删除不可逆，需先定范围）","multi_select true,":false,"options[{":":","label":"全量治理（推荐）","description":"瘦身 67MB 截图。"},{"header":"","id":"","question":"","options[:]":"","label":"只瘦身 + 提炼","description":"只做体积瘦身。"}]}'

/** 合法参数（对照：不能因为宽容而丢掉正常字段）。 */
const HEALTHY = JSON.stringify({
  questions: [
    {
      header: '执行深度',
      id: 'scope',
      question: '要做到哪个深度？',
      multiSelect: true,
      options: [
        { label: '全量', description: '一次做透' },
        { label: '只瘦身' },
      ],
    },
    { header: '备份', id: 'backup', question: '要不要先备份？', multiSelect: false, options: [{ label: '要' }] },
  ],
})

describe('parseAskQuestions', () => {
  it('合法参数：题干、分组名、多选标记与选项全部读出', () => {
    const questions = parseAskQuestions(HEALTHY)
    expect(questions).not.toBeNull()
    expect(questions).toHaveLength(2)
    expect(questions?.[0]?.question).toBe('要做到哪个深度？')
    expect(questions?.[0]?.header).toBe('执行深度')
    expect(questions?.[0]?.multiSelect).toBe(true)
    expect(questions?.[0]?.options).toEqual([
      { label: '全量', description: '一次做透' },
      { label: '只瘦身' },
    ])
    expect(questions?.[1]?.multiSelect).toBe(false)
  })

  it('★ 坏键参数：仍能读出第一题的题干（不得整组判 null ⇒ 不得回落到原始 JSON）', () => {
    const questions = parseAskQuestions(CORRUPTED)
    expect(questions, '坏键但题干可读时，绝不能返回 null').not.toBeNull()
    expect(questions?.[0]?.question).toContain('文档治理要做到哪个深度')
    expect(questions?.[0]?.header).toBe('执行深度')
    // 选项键被写坏 ⇒ 该题退化为「可自由回答」，而不是把整行丢掉。
    expect(questions?.[0]?.options).toEqual([])
  })

  it('完全没有题干的条目被跳过', () => {
    const questions = parseAskQuestions(CORRUPTED)
    expect(questions).toHaveLength(1)
  })

  it('非 JSON / 非对象 / questions 非数组 ⇒ null（交给降级壳）', () => {
    expect(parseAskQuestions('not json')).toBeNull()
    expect(parseAskQuestions('[]')).toBeNull()
    expect(parseAskQuestions('{"questions":"nope"}')).toBeNull()
  })

  it('一个题干和选项都读不出 ⇒ null（不伪造空问题）', () => {
    expect(parseAskQuestions('{"questions":[{"id":"a","question":"","options":[]}]}')).toBeNull()
    expect(parseAskQuestions('{"questions":[]}')).toBeNull()
  })
})

describe('answeredCount', () => {
  it('只数真正作答的条目（跳过空选择）', () => {
    expect(answeredCount('{"answers":[{"id":"a","selected":["x"]},{"id":"b","selected":[]},{"id":"c","selected":[],"custom":"手写"}]}')).toBe(2)
    expect(answeredCount('{"answers":[]}')).toBe(0)
    expect(answeredCount(undefined)).toBe(0)
    expect(answeredCount('garbage')).toBe(0)
  })
})

describe('askQuestionModel', () => {
  const block = (argsRaw: string, settled?: { content: unknown[]; isError?: boolean }) => (
    settled === undefined
      ? { parentCallId: undefined, callId: 'c1', name: 'ask_user_question', argsRaw }
      : {
          kind: 'tool-result',
          parentCallId: undefined,
          call: { callId: 'c1', name: 'ask_user_question', argsRaw },
          content: settled.content,
          isError: settled.isError === true,
        }
  )

  it('运行中：running=true，不作答', () => {
    const model = askQuestionModel(block(CORRUPTED) as never)
    expect(model.running).toBe(true)
    expect(model.answered).toBe(0)
    expect(model.questions).toHaveLength(1)
  })

  it('已结束：读出答案条数，原始参数始终保留（供降级壳展示）', () => {
    const model = askQuestionModel(block(HEALTHY, {
      content: [{ type: 'text', text: '{"answers":[{"id":"scope","selected":["全量"]},{"id":"backup","selected":[]}]}' }],
    }) as never)
    expect(model.running).toBe(false)
    expect(model.answered).toBe(1)
    expect(model.total).toBe(2)
    expect(model.raw).toBe(HEALTHY)
  })

  it('参数不完整时 questions 为空、raw 仍在（渲染层据此走降级壳）', () => {
    const model = askQuestionModel(block('{"questions":[]}') as never)
    expect(model.questions).toEqual([])
    expect(model.raw).toBe('{"questions":[]}')
  })

  it('resultText 取结果第一段文本', () => {
    expect(resultText(block(HEALTHY, { content: [{ type: 'text', text: 'hi' }] }) as never)).toBe('hi')
    expect(resultText(block(HEALTHY) as never)).toBeUndefined()
  })
})
