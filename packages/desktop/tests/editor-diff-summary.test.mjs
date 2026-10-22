import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeLineChanges } from '../lib/types/client/editor/diff-summary.js'

test('尚未完成比较和无差异时不虚报增删行数', () => {
  assert.deepEqual(summarizeLineChanges(null), { added: 0, removed: 0, count: 0 })
  assert.deepEqual(summarizeLineChanges([]), { added: 0, removed: 0, count: 0 })
})

test('纯插入的 originalEndLineNumber=0 不计作删除', () => {
  assert.deepEqual(summarizeLineChanges([
    { originalStartLineNumber: 4, originalEndLineNumber: 0, modifiedStartLineNumber: 5, modifiedEndLineNumber: 7 },
  ]), { added: 3, removed: 0, count: 1 })
})

test('纯删除的 modifiedEndLineNumber=0 不计作新增', () => {
  assert.deepEqual(summarizeLineChanges([
    { originalStartLineNumber: 1, originalEndLineNumber: 2, modifiedStartLineNumber: 0, modifiedEndLineNumber: 0 },
  ]), { added: 0, removed: 2, count: 1 })
})

test('多处替换累加实际行数，而非字符差异数量', () => {
  assert.deepEqual(summarizeLineChanges([
    { originalStartLineNumber: 2, originalEndLineNumber: 3, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 },
    { originalStartLineNumber: 10, originalEndLineNumber: 10, modifiedStartLineNumber: 9, modifiedEndLineNumber: 12 },
  ]), { added: 5, removed: 3, count: 2 })
})
