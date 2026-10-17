/**
 * corum-issue-reporter host 半边的**只读自检**：证明 URL 构造、请求体、响应解析、
 * 错误分类、资产文件名安全化是对的。
 *
 * 纪律：**不发任何网络请求、不读也不带任何 token**——它只 import tsc 产物
 * `lib/types/github-api.js`（纯函数层，零依赖零 IO）后逐条断言。
 *
 * 用法：`node scripts/check-github-pure.mjs`（在包目录下执行；需先 `tsc -b`）。
 */

import assert from 'node:assert/strict'
import * as api from '../lib/types/github-api.js'

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

console.log('corum-issue-reporter / github-api 纯函数自检（无网络、无 token）\n')

// ── 端点与请求体 ────────────────────────────────────────────────────
console.log('[URL / body]')
check('device flow 两端点都在 https://github.com', () => {
  assert.equal(api.DEVICE_CODE_URL, 'https://github.com/login/device/code')
  assert.equal(api.ACCESS_TOKEN_URL, 'https://github.com/login/oauth/access_token')
})
check('device code body = client_id + scope=public_repo', () => {
  assert.equal(api.buildDeviceCodeBody('Ov23lidmyYwphoulfCj0'), 'client_id=Ov23lidmyYwphoulfCj0&scope=public_repo')
})
check('access token body 带 urlencoded 的 device_code grant_type', () => {
  assert.equal(
    api.buildAccessTokenBody('CID', 'DEV-1'),
    'client_id=CID&device_code=DEV-1&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code',
  )
})
check('REST 端点全在 https://api.github.com', () => {
  assert.equal(api.currentUserUrl(), 'https://api.github.com/user')
  assert.equal(api.userReposUrl(), 'https://api.github.com/user/repos')
  assert.equal(api.repoUrl('alice', 'corum-issue-assets-alice'), 'https://api.github.com/repos/alice/corum-issue-assets-alice')
  assert.equal(api.labelsUrl('kukucaiCndy', 'Corum-Harness'), 'https://api.github.com/repos/kukucaiCndy/Corum-Harness/labels?per_page=100')
  assert.equal(api.issuesUrl('kukucaiCndy', 'Corum-Harness'), 'https://api.github.com/repos/kukucaiCndy/Corum-Harness/issues')
})
check('Contents API URL 落在 issues/YYYY-MM/<name>', () => {
  assert.equal(
    api.contentsUrl('alice', 'corum-issue-assets-alice', 'issues/2026-10/shot.png'),
    'https://api.github.com/repos/alice/corum-issue-assets-alice/contents/issues/2026-10/shot.png',
  )
})
check('上传 body = { message: "add <name>", content: base64 }', () => {
  assert.deepEqual(api.buildUploadBody('shot.png', 'AAAA'), { message: 'add shot.png', content: 'AAAA' })
})
check('月份目录取 UTC（YYYY-MM）+ 路径拼接', () => {
  assert.equal(api.assetMonth(new Date('2026-10-18T23:30:00Z')), '2026-10')
  assert.equal(api.assetMonth(new Date('2026-01-01T00:00:00Z')), '2026-01')
  assert.equal(api.contentPath('2026-10', 'shot.png'), 'issues/2026-10/shot.png')
})
check('资产仓库名 = corum-issue-assets-<login>', () => {
  assert.equal(api.assetRepoName('alice'), 'corum-issue-assets-alice')
  assert.equal(api.ASSETS_REPO_DESCRIPTION, 'Screenshots attached to issues reported from the Corum app')
})

// ── 文件名安全化 ────────────────────────────────────────────────────
console.log('\n[资产文件名安全化]')
check('空格/大小写归一 + 保留允许扩展名', () => {
  assert.equal(api.sanitizeAssetName('Screen Shot 2026-10-18 at 12.00.11.PNG'), 'ScreenShot2026-10-18at12.00.11.png')
})
check('路径穿越被剥掉（../../etc/passwd）', () => {
  assert.equal(api.sanitizeAssetName('../../etc/passwd'), 'etcpasswd.png')
})
check('非允许扩展名强制落到 .png', () => {
  assert.equal(api.sanitizeAssetName('shot.jpeg'), 'shot.jpeg.png')
})
check('空名/纯符号名回落 screenshot', () => {
  assert.equal(api.sanitizeAssetName(''), 'screenshot.png')
  assert.equal(api.sanitizeAssetName('截图.png'), 'screenshot.png')
  assert.equal(api.sanitizeAssetName('@#$'), 'screenshot.png')
})
check('长度上限 80（含扩展名）', () => {
  const long = api.sanitizeAssetName(`${'a'.repeat(200)}.png`)
  assert.equal(long.length, api.ASSET_NAME_MAX)
  assert.ok(long.endsWith('.png'))
})
check('冲突后缀：4 位 base36，插在扩展名前', () => {
  assert.match(api.suffixToken(0), /^[0-9a-z]{4}$/)
  assert.match(api.suffixToken(0.999999), /^[0-9a-z]{4}$/)
  assert.equal(api.withSuffix('shot.png', 'ab12'), 'shot-ab12.png')
  const long = api.withSuffix(api.sanitizeAssetName(`${'b'.repeat(100)}.png`), 'zzzz')
  assert.ok(long.length <= api.ASSET_NAME_MAX && long.endsWith('-zzzz.png'))
})
check('base64 前缀剥离', () => {
  assert.equal(api.stripBase64Prefix('data:image/png;base64,AAAA'), 'AAAA')
  assert.equal(api.stripBase64Prefix('AAAA'), 'AAAA')
})

// ── label 策略 ──────────────────────────────────────────────────────
console.log('\n[label 过滤 / 解析]')
check('只提交目标仓库已存在的 label', () => {
  assert.deepEqual(
    api.buildIssuePayload('t', 'b', ['bug', 'ui'], ['bug', 'nope']),
    { title: 't', body: 'b', labels: ['bug'] },
  )
})
check('无可用 label 时整体省略 labels 字段', () => {
  const none = api.buildIssuePayload('t', 'b', ['bug'], [])
  assert.equal('labels' in none, false)
  const mismatch = api.buildIssuePayload('t', 'b', [], ['bug'])
  assert.equal('labels' in mismatch, false)
})
check('labels 响应解析（脏数据给空）', () => {
  assert.deepEqual(api.parseLabelNames([{ name: 'bug' }, { name: '' }, {}, 'x']), ['bug'])
  assert.deepEqual(api.parseLabelNames({ message: 'nope' }), [])
})
check('scopes 头解析', () => {
  assert.equal(api.parseScopesHeader('public_repo, read:user'), 'public_repo, read:user')
  assert.equal(api.parseScopesHeader(null), '')
})

// ── 错误分类 ────────────────────────────────────────────────────────
console.log('\n[错误分类]')
check('403 + x-ratelimit-remaining=0 ⇒ rate-limited（带可读恢复时间）', () => {
  const failure = api.classifyApiFailure({
    status: 403,
    rateLimitRemaining: '0',
    rateLimitReset: '1795000000',
    body: { message: 'API rate limit exceeded for user ID 1.' },
  })
  assert.equal(failure.ok, false)
  assert.equal(failure.code, 'rate-limited')
  assert.ok(failure.message.includes(api.readableReset('1795000000')))
  assert.ok(failure.message.includes('2026-'))
})
check('403 但不是限流 ⇒ forbidden', () => {
  const failure = api.classifyApiFailure({ status: 403, rateLimitRemaining: '42', body: { message: 'Resource not accessible by integration' } })
  assert.equal(failure.code, 'forbidden')
})
check('401 ⇒ invalid-token（提示重新授权）', () => {
  const failure = api.classifyApiFailure({ status: 401, body: { message: 'Bad credentials' } })
  assert.equal(failure.code, 'invalid-token')
  assert.ok(/重新授权/.test(failure.message))
})
check('404 / 410 / 5xx 各自成码', () => {
  assert.equal(api.classifyApiFailure({ status: 404, body: { message: 'Not Found' } }).code, 'not-found')
  assert.equal(api.classifyApiFailure({ status: 410, body: { message: 'Issues are disabled' } }).code, 'issues-disabled')
  assert.equal(api.classifyApiFailure({ status: 502, body: {} }).code, 'server-error')
  assert.equal(api.classifyApiFailure({ status: 418, body: {} }).code, 'http-error')
})
check('422 带 errors[] ⇒ validation-failed（message 与 errors 原文都在）', () => {
  const failure = api.classifyApiFailure({
    status: 422,
    body: {
      message: 'Validation Failed',
      errors: [{ resource: 'Issue', field: 'title', code: 'missing_field' }],
    },
  })
  assert.equal(failure.code, 'validation-failed')
  assert.ok(failure.message.includes('Validation Failed'))
  assert.ok(failure.message.includes('missing_field'))
  assert.ok(failure.detail.includes('Validation Failed'))
})
check('网络异常：超时 vs 其它', () => {
  const abort = new Error('This operation was aborted')
  abort.name = 'AbortError'
  const timeout = api.classifyFetchError(abort, 15000)
  assert.equal(timeout.code, 'timeout')
  assert.ok(timeout.message.includes('15s'))
  const network = api.classifyFetchError(new Error('fetch failed'), 15000)
  assert.equal(network.code, 'network-error')
  assert.ok(network.message.includes('fetch failed'))
})
check('失败信封里不含任何 token 形状的字面量', () => {
  const samples = [
    api.classifyApiFailure({ status: 401, body: { message: 'Bad credentials' } }),
    api.classifyApiFailure({ status: 403, rateLimitRemaining: '0', rateLimitReset: '1795000000', body: {} }),
    api.classifyFetchError(new Error('fetch failed'), 15000),
    api.fail('no-token', '尚未授权 GitHub：请先完成设备授权'),
  ]
  for (const sample of samples) {
    const text = JSON.stringify(sample)
    assert.equal(/ghp_|github_pat_|gho_|ghu_|Bearer /.test(text), false, text)
  }
  assert.equal('detail' in api.fail('x', 'y'), false)
})

// ── 响应解析（用父 Agent 实测过的真实响应体）────────────────────────
console.log('\n[GitHub 响应解析]')
const REAL_DEVICE_CODE = {
  device_code: '577212b83e41cf944f022aaacaa4d47a4e420de8c2',
  user_code: '6C97-B103',
  verification_uri: 'https://github.com/login/device',
  expires_in: 899,
  interval: 5,
}
check('device code 真实响应字段名对齐', () => {
  assert.deepEqual(api.parseDeviceCodeResponse(REAL_DEVICE_CODE), {
    deviceCode: '577212b83e41cf944f022aaacaa4d47a4e420de8c2',
    userCode: '6C97-B103',
    verificationUri: 'https://github.com/login/device',
    expiresIn: 899,
    interval: 5,
  })
})
check('device code 缺字段 ⇒ null（转 parse-error）', () => {
  assert.equal(api.parseDeviceCodeResponse({ user_code: 'X' }), null)
  assert.equal(api.parseDeviceCodeResponse(null), null)
})
check('access_token 三分支解析', () => {
  assert.deepEqual(api.parseAccessTokenResponse({ access_token: 'T', scope: 'public_repo', token_type: 'bearer' }), { accessToken: 'T', scope: 'public_repo' })
  assert.deepEqual(api.parseAccessTokenResponse({ error: 'authorization_pending', error_description: 'pending' }), { error: 'authorization_pending', errorDescription: 'pending' })
  assert.equal(api.parseAccessTokenResponse({ error: 'slow_down' }).error, 'slow_down')
})
check('issue / contents 响应字段解析', () => {
  assert.equal(api.parseIssueNumber({ number: 42 }), 42)
  assert.equal(api.parseHtmlUrl({ html_url: 'https://github.com/kukucaiCndy/Corum-Harness/issues/42' }), 'https://github.com/kukucaiCndy/Corum-Harness/issues/42')
  assert.equal(api.parseApiUrl({ url: 'https://api.github.com/repos/o/r/issues/42' }), 'https://api.github.com/repos/o/r/issues/42')
  assert.equal(api.parseLogin({ login: 'alice' }), 'alice')
  assert.equal(
    api.parseDownloadUrl({ content: { download_url: 'https://raw.githubusercontent.com/o/r/main/issues/2026-10/shot.png', html_url: 'https://github.com/o/r/blob/main/issues/2026-10/shot.png' } }),
    'https://raw.githubusercontent.com/o/r/main/issues/2026-10/shot.png',
  )
  assert.equal(api.parseContentHtmlUrl({ content: { html_url: 'https://github.com/o/r/blob/main/issues/2026-10/shot.png' } }), 'https://github.com/o/r/blob/main/issues/2026-10/shot.png')
})
check('readableReset 非法输入给 null', () => {
  assert.equal(api.readableReset(null), null)
  assert.equal(api.readableReset(''), null)
  assert.equal(api.readableReset('abc'), null)
  assert.equal(api.readableReset('1795000000'), '2026-11-18T11:06:40.000Z')
})

console.log(`\n${passed} assertions passed（0 次网络请求、0 个 token）`)
