import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getWorker } from '../lib/types/client/editor/worker.js'

// Node 没有浏览器 Worker；只替换这一外部边界，Blob 与响应体读取仍走真实实现。
function browserBoundary(t, fetch) {
  const previous = { fetch: globalThis.fetch, Worker: globalThis.Worker }
  globalThis.fetch = fetch
  globalThis.Worker = class {
    constructor(url, options) { this.url = url; this.name = options.name }
  }
  t.after(() => Object.assign(globalThis, previous))
}

test('冷缓存必须等待资源并返回 Worker，不能以 undefined 触发 Monaco 的 bundler fallback', async t => {
  let finish
  let fetches = 0
  browserBoundary(t, async () => { fetches++; return await new Promise(resolve => { finish = resolve }) })
  const first = getWorker('workerMain.js', 'typescript')
  const second = getWorker('workerMain.js', 'typescript')
  assert.equal(typeof first?.then, 'function')
  assert.equal(typeof second?.then, 'function')
  assert.equal(fetches, 1)
  finish(new Response('self.onmessage = () => {}'))
  const [a, b] = await Promise.all([first, second])
  assert.equal(a.url, b.url)
  assert.match(a.url, /^blob:/)
  assert.notEqual(a, b)
})

test('资源加载失败会明确拒绝，下一次请求可以重新加载', async t => {
  let fetches = 0
  browserBoundary(t, async () => ++fetches === 1 ? new Response('', { status: 404 }) : new Response('self.onmessage = () => {}'))
  await assert.rejects(Promise.resolve(getWorker('workerMain.js', 'json')), /failed to fetch worker json.worker.js: 404/)
  const worker = await getWorker('workerMain.js', 'json')
  assert.equal(fetches, 2)
  assert.match(worker.url, /^blob:/)
})
