// 在已运行的开发版与独立测试工作区中执行：
// node tests/editor-save.e2e.mjs --port=9335 --root=<absolute-test-workspace>
import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)))
assert.ok(args.root, '必须显式指定独立测试工作区 --root')
const root = resolve(args.root)
const name = `editor-save-e2e-${Date.now()}.txt`
const file = join(root, name)
const pages = await (await fetch(`http://127.0.0.1:${args.port ?? 9335}/json/list`)).json()
const page = pages.find(page => page.type === 'page' && page.url.startsWith('http://127.0.0.1:'))
assert.ok(page, '开发版页面未就绪')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
const pending = new Map()
const errors = new Set()
let sequence = 0
let paused
let created = false
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)) }, 10000)
  pending.set(id, message => { clearTimeout(timer); message.error ? reject(Error(message.error.message)) : resolve(message.result) })
  ws.send(JSON.stringify({ id, method, params }))
})
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) }
  if (message.method === 'Fetch.requestPaused') paused = message.params.requestId
  if (message.method === 'Runtime.exceptionThrown') errors.add((message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text).split('\n')[0])
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.add(message.params.args.map(arg => arg.value ?? arg.description).join(' ').split('\n')[0])
}
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const waitFor = async predicate => {
  const deadline = Date.now() + 5000
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, '等待编辑器状态超时')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
const append = async text => {
  const point = await evaluate(`(() => { const box=document.querySelector('[data-code-editor-column] .monaco-editor .view-lines').getBoundingClientRect(); return {x:box.x+20,y:box.y+10} })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 })
  await send('Input.insertText', { text })
}
const dirty = () => evaluate(`!!document.querySelector('[data-editor-tab="/${name}"] [aria-label="未保存"]')`)
const save = () => evaluate(`(() => {document.querySelector('button[aria-label="保存当前文件"]').click(); return true})()`)
try {
  await send('Runtime.enable')
  const currentRoot = await evaluate(`(async()=>{const method='corumFs/absolutePath';const response=await fetch('/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'save-e2e-root',method,payload:{args:{path:'/'}}})});const result=(await response.json()).result;if(!result.ok)throw Error('无法确认测试工作区');return result.value.absolutePath})()`)
  const normalize = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
  assert.equal(normalize(currentRoot), normalize(root), '开发版当前根目录必须与 --root 一致')
  await writeFile(file, 'initial\n', { flag: 'wx' })
  created = true
  await evaluate(`(async()=>{let api;for(const element of document.querySelectorAll('*')){const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));for(let fiber=key?element[key]:null,depth=0;fiber&&depth<20;fiber=fiber.return,depth++)if(fiber.memoizedProps?.editorApi?.openFile){api=fiber.memoizedProps.editorApi;break}if(api)break}if(!api)throw Error('请先显示编辑器');await api.openFile('/${name}',{pin:true});return true})()`)
  await waitFor(() => evaluate(`!!document.querySelector('[data-code-editor-column] .monaco-editor')`))
  await append('snapshot-A\n')
  await waitFor(dirty)
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/corumFs/write', requestStage: 'Response' }] })
  await save()
  await waitFor(() => paused !== undefined)
  assert.ok((await readFile(file, 'utf8')).includes('snapshot-A'))
  await append('pending-B\n')
  assert.ok(!(await readFile(file, 'utf8')).includes('pending-B'))
  await send('Fetch.continueResponse', { requestId: paused })
  paused = undefined
  await send('Fetch.disable')
  await waitFor(() => evaluate(`![...document.querySelectorAll('[role="status"]')].some(node=>node.innerText.includes('保存中'))`))
  assert.equal(await dirty(), true, '保存确认只能确认 snapshot-A，尚未写盘的 pending-B 必须保持未保存状态')
  await save()
  await waitFor(async () => !await dirty())
  assert.ok((await readFile(file, 'utf8')).includes('pending-B'), '第二次保存应写入后续输入')
  const editorCommand = command => evaluate(`(() => {for(const element of document.querySelectorAll('[data-code-editor-column] *')){const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));for(let fiber=key?element[key]:null;fiber;fiber=fiber.return)for(let hook=fiber.memoizedState;hook;hook=hook.next){const editor=hook.memoizedState?.current;if(editor?.getRawOptions){const before=editor.getValue();editor.getModel()[${JSON.stringify(command)}]();return {command: ${JSON.stringify(command)},before,after:editor.getValue()}}}}throw Error('Monaco instance missing')})()`)
  await editorCommand('pushStackElement')
  await append('discard-C\n')
  await editorCommand('pushStackElement')
  await waitFor(dirty)
  const undone = await editorCommand('undo')
  assert.notEqual(undone.after, undone.before, '撤销应实际改变 Monaco 内容')
  const redone = await editorCommand('redo')
  assert.equal(redone.after, undone.before, '重做应恢复撤销前内容')
  assert.equal(await dirty(), true)
  await evaluate(`(() => {document.querySelector('[data-editor-tab="/${name}"] button[title="关闭"]').click();return true})()`)
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='取消')`))
  await evaluate(`(() => {Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='取消').click();return true})()`)
  assert.equal(await dirty(), true, '取消关闭必须保留未保存内容')
  await evaluate(`(() => {document.querySelector('[data-editor-tab="/${name}"] button[title="关闭"]').click();return true})()`)
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='仍要关闭')`))
  await evaluate(`(() => {Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='仍要关闭').click();return true})()`)
  await waitFor(() => evaluate(`!document.querySelector('[data-editor-tab="/${name}"]')`))
  assert.ok(!(await readFile(file, 'utf8')).includes('discard-C'), '丢弃修改不能写入磁盘')
  assert.deepEqual([...errors], [])
  console.log('PASS: real input + delayed save response + dirty retention + disk save + undo/redo + cancel/discard close')
} finally {
  try {
    if (paused) await send('Fetch.continueResponse', { requestId: paused }).catch(() => {})
    await send('Fetch.disable').catch(() => {})
    await evaluate(`(async() => {const tab=document.querySelector('[data-editor-tab="/${name}"]');if(!tab)return;tab.querySelector('button[title="关闭"]')?.click();await new Promise(resolve=>setTimeout(resolve,50));if(document.querySelector('[data-editor-tab="/${name}"]'))Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='仍要关闭')?.click()})()`).catch(() => {})
    if (created) await unlink(file)
  } finally {
    ws.close()
  }
}
