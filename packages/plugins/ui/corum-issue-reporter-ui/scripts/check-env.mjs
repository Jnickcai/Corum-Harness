#!/usr/bin/env node
/**
 * 环境表只读自检（`scripts/check-env.mjs`）。
 *
 * 只读：只 import 编译产物（`lib/types/client/env.js`）+ 读本机进程信息，
 * **不写任何文件**、不发网络请求、不启动任何进程。
 *
 * 断言四件事（＝本轮验收点）：
 *   ① 12 行都在（行数与行序都固定，表头/分隔行形态也固定）；
 *   ② 缺项写 `unknown` 而不是整行消失；
 *   ③ 值里的 `|` 不会把 markdown 表格切坏（被换成全角 `／`）；
 *   ④ 产出里不含 home 路径 / 用户名模式的字符串（隐私红线）。
 *
 * 用法（**构建之后**跑）：`node scripts/check-env.mjs`
 */

import { arch, env, versions } from 'node:process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, release, totalmem, type as osType, userInfo, version as osVersion } from 'node:os'

import { detectEnvLocal, envTableMarkdown, mergeEnv, UNKNOWN_LOCAL_ENV } from '../lib/types/client/env.js'

/**
 * 与 host 半边**同一加载点**起算的 require（host 里是 `createRequire(import.meta.url)`，
 * 它所在文件就是 `lib/index.js`）。⑤ 段只借它做样例展示。
 */
const requireFromPlugin = createRequire(new URL('../lib/index.js', import.meta.url))

/** dsh 基座版本的两条解析路径 + 环境变量兜底（与 host 半边的算法逐条对应）。 */
const DSH_MANIFESTS = ['@deepseek-ai/dsh-base/package.json', '@deepseek-ai/dsh-typert-protocol/package.json']

/**
 * 按 host 半边的算法解析 dsh 基座版本，**并带上命中的是哪条路径**（只为样例与取证）。
 * @returns {{ version: string, via: string }} 版本与命中标识（不含路径）。
 */
function resolveSampleDshVersion() {
  for (const spec of DSH_MANIFESTS) {
    try {
      const manifest = JSON.parse(readFileSync(requireFromPlugin.resolve(spec), 'utf8'))
      if (typeof manifest.version === 'string' && manifest.version.trim() !== '') {
        return { version: manifest.version.trim(), via: spec }
      }
    } catch {
      // 该路径不可用，试下一条。
    }
  }
  for (const key of ['DSH_VERSION', 'CORUM_DSH_VERSION', 'DSH_BASELINE_VERSION']) {
    const value = env[key]
    if (typeof value === 'string' && value.trim() !== '') return { version: value.trim(), via: `env ${key}` }
  }
  return { version: 'unknown', via: 'none' }
}

/** 表里的 12 项，顺序即契约（正文/预览都按它）。 */
const EXPECTED_KEYS = [
  'Corum',
  'dsh 基座',
  '运行形态',
  '操作系统',
  'Electron / Chromium',
  'Node / V8',
  '窗口 / 屏幕',
  '语言 / 时区',
  '主题',
  'CPU 线程',
  '内存',
  '窗口形态',
]

/** 失败计数（末尾按它 exit 1）。 */
let failures = 0

/**
 * 记一条断言。
 * @param {string} label - 断言内容。
 * @param {boolean} ok - 是否通过。
 * @param {string} [detail] - 失败时的现场。
 */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  OK   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

/**
 * 把 markdown 拆成「表头之前 / 表头 / 分隔行 / 数据行」。
 * @param {string} markdown - {@link envTableMarkdown} 的产出。
 * @returns {{ head: string, header: string, separator: string, rows: string[] }}
 */
function parse(markdown) {
  const lines = markdown.split('\n')
  return { head: lines[0] ?? '', header: lines[1] ?? '', separator: lines[2] ?? '', rows: lines.slice(3) }
}

/**
 * 取一行数据里的两个单元格（未转义的 `|` 只可能来自值本身 ⇒ 拆分长度必须恒为 4）。
 * @param {string} line - 数据行。
 * @returns {string[]} 拆分片段。
 */
function splitRow(line) {
  return line.split('|')
}

// ── 固定输入（全齐）────────────────────────────────────────────────
const FULL_LOCAL = {
  appVersion: '0.5.0',
  baseline: 'unknown',
  electron: '43.4.1',
  chromium: '155.0.7629.0',
  windowSize: '1602×1078',
  dpr: '1.25',
  screen: '1920×1080',
  language: 'zh-CN',
  timezone: 'Asia/Shanghai',
  theme: 'dark',
  cpuThreads: '16',
  floating: false,
}

const FULL_HOST = {
  dshVersion: '0.1.5-rc.3',
  mode: 'ide',
  debugPort: '9333',
  os: { type: 'Windows_NT', release: '10.0.26200', version: 'Windows 11 Pro', arch: 'x64' },
  node: '22.20.0',
  v8: '12.4',
  memGB: 64,
}

console.log('=== ① 12 行都在 ===')
{
  const parsed = parse(envTableMarkdown(mergeEnv(FULL_LOCAL, FULL_HOST)))
  check('标题是「### 环境」', parsed.head === '### 环境', parsed.head)
  check('表头是「| 项 | 值 |」', parsed.header === '| 项 | 值 |', parsed.header)
  check('分隔行是「| --- | --- |」', parsed.separator === '| --- | --- |', parsed.separator)
  check('数据行 = 12 行', parsed.rows.length === 12, `实际 ${parsed.rows.length} 行`)
  const keys = parsed.rows.map(line => splitRow(line)[1]?.trim() ?? '')
  check('项名与顺序固定', JSON.stringify(keys) === JSON.stringify(EXPECTED_KEYS), JSON.stringify(keys))
  const values = parsed.rows.map(line => splitRow(line)[2]?.trim() ?? '')
  check('值不含裸 `|`（拆分长度恒为 4）', parsed.rows.every(line => splitRow(line).length === 4), JSON.stringify(parsed.rows))
  check('全齐时没有 unknown 值', values.every(value => value !== 'unknown'), JSON.stringify(values))
}

console.log('=== ② 缺项写 unknown，不消失 ===')
{
  const parsed = parse(envTableMarkdown(mergeEnv(UNKNOWN_LOCAL_ENV, null)))
  check('host 全缺时仍是 12 行', parsed.rows.length === 12, `实际 ${parsed.rows.length} 行`)
  const keys = parsed.rows.map(line => splitRow(line)[1]?.trim() ?? '')
  check('行名一个不少', JSON.stringify(keys) === JSON.stringify(EXPECTED_KEYS), JSON.stringify(keys))
  const values = parsed.rows.map(line => splitRow(line)[2]?.trim() ?? '')
  check(
    '缺项的值是 unknown（窗口形态除外：它恒可判定）',
    values.slice(0, 11).every(value => value === 'unknown'),
    JSON.stringify(values),
  )
  check('窗口形态仍可判定（缺项不影响非读取项）', values[11] === '主窗', values[11])
}

console.log('=== ③ 值里的 `|` 被替换（不切坏表格）===')
{
  const dirty = { ...FULL_LOCAL, appVersion: '0.5.0|注入', language: 'zh-CN|evil' }
  const markdown = envTableMarkdown(mergeEnv(dirty, FULL_HOST))
  const parsed = parse(markdown)
  check('脏值输入后仍是 12 行', parsed.rows.length === 12, `实际 ${parsed.rows.length} 行`)
  check('每行仍有且只有两个单元格', parsed.rows.every(line => splitRow(line).length === 4), JSON.stringify(parsed.rows))
  check('冒号竖线被换成全角 ／', markdown.includes('v0.5.0／注入') && markdown.includes('zh-CN／evil'))
  check('markdown 里没有裸 `|注入`', !markdown.includes('|注入') && !markdown.includes('|evil'))
}

console.log('=== ④ 不含 home 路径 / 用户名模式 ===')
{
  const markdown = envTableMarkdown(mergeEnv(FULL_LOCAL, FULL_HOST))
  const home = homedir()
  const user = (() => {
    try {
      return userInfo().username
    } catch {
      return ''
    }
  })()
  const patterns = [
    /[A-Za-z]:[\\/]/, // Windows 盘符路径
    /\/(?:Users|home)\//i, // POSIX home
    /\\Users\\/i, // Windows home
    /~\//, // 波浪号路径
  ]
  check('不含盘符/POSIX/Windows home 路径片段', patterns.every(pattern => !pattern.test(markdown)), JSON.stringify(patterns.map(p => p.source)))
  check('不含本机 home 目录原文', home === '' || !markdown.toLowerCase().includes(home.toLowerCase()), home)
  check('不含本机用户名', user === '' || !markdown.toLowerCase().includes(user.toLowerCase()), user)
}

console.log('=== ⑤ 真机实跑（node 里没有 DOM：渲染层独有字段会是 unknown，host 半边是本机真实值）===')
{
  const local = await detectEnvLocal()
  const dsh = resolveSampleDshVersion()
  console.log(`dsh 基座版本：${dsh.version}（命中路径：${dsh.via}）`)
  const host = {
    dshVersion: dsh.version,
    mode: env.CORUM_DESKTOP_MODE === undefined || env.CORUM_DESKTOP_MODE === '' ? 'unknown' : env.CORUM_DESKTOP_MODE,
    debugPort: env.CORUM_DEBUG_PORT === undefined || env.CORUM_DEBUG_PORT === '' ? null : env.CORUM_DEBUG_PORT,
    os: {
      type: osType(),
      release: release(),
      version: osType().startsWith('Windows') ? osVersion() : '',
      arch,
    },
    node: versions.node ?? 'unknown',
    v8: versions.v8 ?? 'unknown',
    memGB: Math.round(totalmem() / 1024 ** 3),
  }
  console.log('--- detectEnvLocal() 在 node 下的真实返回 ---')
  console.log(JSON.stringify(local, null, 2))
  console.log('--- mergeEnv(local, host) 的真实 body 片段 ---')
  const rows = mergeEnv(local, host)
  console.log(envTableMarkdown(rows))
  check('真机实跑也是 12 行', rows.length === 12, `实际 ${rows.length}`)
}

console.log('')
if (failures === 0) {
  console.log('结论：全部断言通过')
  process.exit(0)
}
console.log(`结论：${failures} 条断言失败`)
process.exit(1)
