/**
 * diff.ts 单测：LCS 行级 diff + 折叠 hunks。
 *
 * 覆盖：
 * - 单行改动（增/删/改）的行数统计与 hunk 结构。
 * - 折叠段：差异间隔大 ⇒ 拆成多 hunk + folded 段。
 * - 空文本、全同、全删、全增等边界。
 * - 行号正确性（leftNum/rightNum，add 行 leftNum=null 等）。
 * - diffFile 带 path 包装。
 *
 * 纯函数、无磁盘副作用，故无需夹具。
 */
import { describe, it, expect } from 'vitest'
import { diffText, diffFile, type DiffHunkLine } from '../src/diff.ts'

describe('diffText — 行数统计', () => {
  it('完全相同 ⇒ 0 增 0 删，空 hunks', () => {
    const r = diffText('a\nb\nc', 'a\nb\nc')
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
    expect(r.hunks).toHaveLength(0)
  })

  it('单行改动（b→B）⇒ 1 增 1 删', () => {
    const r = diffText('a\nb\nc', 'a\nB\nc')
    expect(r.added).toBe(1)
    expect(r.removed).toBe(1)
    expect(r.hunks).toHaveLength(1)
  })

  it('纯新增末行 ⇒ 1 增 0 删', () => {
    const r = diffText('a\nb', 'a\nb\nc')
    expect(r.added).toBe(1)
    expect(r.removed).toBe(0)
  })

  it('纯删除末行 ⇒ 0 增 1 删', () => {
    const r = diffText('a\nb\nc', 'a\nb')
    expect(r.added).toBe(0)
    expect(r.removed).toBe(1)
  })

  it('两侧都空 ⇒ 空 hunks', () => {
    const r = diffText('', '')
    expect(r.hunks).toHaveLength(0)
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
  })

  it('左空右有文本 ⇒ 全增', () => {
    const r = diffText('', 'x\ny\nz')
    expect(r.added).toBe(3)
    expect(r.removed).toBe(0)
    expect(r.hunks).toHaveLength(1)
    // 全是 add 行，leftNum 全 null。
    const allAdd = r.hunks[0].lines.every(l => l.kind === 'add' && l.leftNum === null)
    expect(allAdd).toBe(true)
  })

  it('左有文本右空 ⇒ 全删', () => {
    const r = diffText('x\ny\nz', '')
    expect(r.added).toBe(0)
    expect(r.removed).toBe(3)
    expect(r.hunks).toHaveLength(1)
    const allDel = r.hunks[0].lines.every(l => l.kind === 'del' && l.rightNum === null)
    expect(allDel).toBe(true)
  })
})

describe('diffText — 行号正确性', () => {
  it('same 行两侧都有行号；del 行 rightNum=null；add 行 leftNum=null', () => {
    const r = diffText('a\nb\nc', 'a\nB\nc')
    const lines = r.hunks[0].lines
    // 期望：same a, del b, add B, same c
    expect(lines.map(l => l.kind)).toEqual(['same', 'del', 'add', 'same'])
    // same a：leftNum=1, rightNum=1
    expect(lines[0].leftNum).toBe(1)
    expect(lines[0].rightNum).toBe(1)
    // del b：leftNum=2, rightNum=null
    expect(lines[1].leftNum).toBe(2)
    expect(lines[1].rightNum).toBeNull()
    // add B：leftNum=null, rightNum=2
    expect(lines[2].leftNum).toBeNull()
    expect(lines[2].rightNum).toBe(2)
    // same c：leftNum=3, rightNum=3
    expect(lines[3].leftNum).toBe(3)
    expect(lines[3].rightNum).toBe(3)
  })

  it('内容字段不含换行符', () => {
    const r = diffText('a\nb\n', 'a\nB\n')
    for (const h of r.hunks) {
      for (const l of h.lines) {
        expect(l.content).not.toContain('\n')
      }
    }
  })

  it('CRLF 与 LF 不因换行符不同被误判为差异', () => {
    const r = diffText('a\r\nb\r\nc', 'a\nb\nc')
    // 换行符归一后两侧相同 ⇒ 无差异。
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
    expect(r.hunks).toHaveLength(0)
  })
})

describe('diffText — 折叠段', () => {
  it('差异间隔大 ⇒ 拆成多 hunk，第二段带 folded', () => {
    // 30 行，改第 5 行和第 25 行。
    const left = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n')
    const right = Array.from({ length: 30 }, (_, i) =>
      i === 4 ? 'CHANGED5' : i === 24 ? 'CHANGED25' : `line${i}`,
    ).join('\n')
    const r = diffText(left, right)
    expect(r.hunks.length).toBe(2)
    // 第一个 hunk 在文件开头附近，前面无折叠段。
    expect(r.hunks[0].folded).toBeUndefined()
    // 第二个 hunk 前面有折叠段（中间的相同行）。
    expect(r.hunks[1].folded).toBeDefined()
    expect(r.hunks[1].folded!.count).toBeGreaterThan(0)
    // folded 的 startLeft/startRight 应指向中间段的第一行。
    expect(r.hunks[1].folded!.startLeft).toBeGreaterThan(r.hunks[0].lines.at(-1)!.leftNum!)
    expect(r.hunks[1].folded!.startRight).toBeGreaterThan(r.hunks[0].lines.at(-1)!.rightNum!)
  })

  it('差异间隔小（≤ 阈值）⇒ 同一 hunk，无折叠段', () => {
    // 改第 2 行和第 5 行，间隔 2 行相同（< FOLD_THRESHOLD=6）。
    const left = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n')
    const right = Array.from({ length: 10 }, (_, i) =>
      i === 1 ? 'X' : i === 4 ? 'Y' : `line${i}`,
    ).join('\n')
    const r = diffText(left, right)
    expect(r.hunks).toHaveLength(1)
    expect(r.hunks[0].folded).toBeUndefined()
  })

  it('单个差异在文件中部 ⇒ 头尾各有上下文', () => {
    const left = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n')
    const right = left.replace('line4', 'CHANGED')
    const r = diffText(left, right)
    expect(r.hunks).toHaveLength(1)
    const lines = r.hunks[0].lines
    // 应有上下文：line1,2,3（头）+ del line4 + add CHANGED + line5,6,7（尾）。
    // CONTEXT_LINES=3，但 line0 在 line4 前 4 行 ⇒ 头部从 line1 开始（3 行）。
    expect(lines.length).toBeGreaterThanOrEqual(5)
    expect(lines.some(l => l.kind === 'del')).toBe(true)
    expect(lines.some(l => l.kind === 'add')).toBe(true)
    // 上下文是 same。
    expect(lines[0].kind).toBe('same')
    expect(lines.at(-1)!.kind).toBe('same')
  })
})

describe('diffFile — 带路径包装', () => {
  it('带 path 字段 + 统计透传', () => {
    const r = diffFile('SKILL.md', 'a\nb', 'a\nB')
    expect(r.path).toBe('SKILL.md')
    expect(r.added).toBe(1)
    expect(r.removed).toBe(1)
    expect(r.hunks).toHaveLength(1)
  })
})

describe('diffText — 上下文行数边界', () => {
  it('差异在文件最开头 ⇒ 头部上下文被裁到 0（不越界）', () => {
    const r = diffText('a\nb\nc\nd\ne', 'X\nb\nc\nd\ne')
    expect(r.hunks).toHaveLength(1)
    const lines = r.hunks[0].lines
    // 第一行应是差异行（无头部上下文，因为 diff 在第 0 行）。
    expect(lines[0].kind === 'del' || lines[0].kind === 'add').toBe(true)
  })

  it('差异在文件最末尾 ⇒ 尾部上下文被裁到 0（不越界）', () => {
    const r = diffText('a\nb\nc\nd\ne', 'a\nb\nc\nd\nX')
    expect(r.hunks).toHaveLength(1)
    const lines = r.hunks[0].lines
    // 最后一行应是差异行（无尾部上下文）。
    expect(lines.at(-1)!.kind === 'del' || lines.at(-1)!.kind === 'add').toBe(true)
  })
})

describe('diffText — 行号连续性', () => {
  it('same 行的 leftNum/rightNum 都单调非递减', () => {
    const left = 'a\nb\nc\nd\ne\nf\ng\nh'
    const right = 'a\nb\nX\nd\ne\nY\ng\nh'
    const r = diffText(left, right)
    for (const h of r.hunks) {
      const sameLines = h.lines.filter((l): l is DiffHunkLine & { leftNum: number; rightNum: number } =>
        l.kind === 'same')
      for (let i = 1; i < sameLines.length; i++) {
        expect(sameLines[i].leftNum).toBeGreaterThanOrEqual(sameLines[i - 1].leftNum)
        expect(sameLines[i].rightNum).toBeGreaterThanOrEqual(sameLines[i - 1].rightNum)
      }
    }
  })
})
