/**
 * corum-issue-reporter host 半边的**服务面自检**：拿**官方实现的** `remoteMethods()`
 * 读出编译产物里真正注册的 @Remote 端点，并按 typert SRC 网关的形参规则复算一遍
 * （`methodParameterNames`，逻辑照抄 dsh-api-gateway/lib/index.js:1010-1039）。
 *
 * 为什么必须验这一条：网关是**用函数源码解析形参名**的，解构 / 默认值 / rest 一律
 * 抛 `gateway/signature-invalid`——「编译过」完全不代表线上调用得通。
 *
 * 而且 `@Remote` 的元数据不是类定义期写上的：官方实现是
 * `context.addInitializer(function () { mark(Object.getPrototypeOf(this), …) })`
 * （`dsh-typert-protocol/lib/index.js:145-153`），即**构造实例时才盖章**。所以本脚本
 * 真的 `new` 一个服务实例来读端点——用一个全新的根 cordis Context（不挂真插件、
 * 不注册宿主服务、不碰凭据库；构造函数里没有任何 IO）。
 *
 * 纪律：不联网、不读 token。用法：`node scripts/check-github-remote.mjs`。
 */

import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  GITHUB_CLIENT_ID,
  IssueReporterService,
  TARGET_REPO,
  TOKEN_REF,
  apply,
  inject,
  name,
} from '../lib/index.js'

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

/** typert SRC 网关的形参规则（逐字复刻；非法形态返回 null）。 */
function gatewayParameterNames(implementation) {
  const source = Function.prototype.toString.call(implementation)
  const open = source.indexOf('(')
  const close = source.indexOf(')', open + 1)
  if (open < 0 || close < 0) return null
  const body = source.slice(open + 1, close).trim()
  if (body.length === 0) return []
  const names = []
  for (const part of body.split(',').map(piece => piece.trim())) {
    if (!/^[$A-Z_a-z][$\w]*$/u.test(part)) return null
    if (names.includes(part)) return null
    names.push(part)
  }
  return names
}

console.log('corum-issue-reporter / @Remote 服务面自检（不联网、不构造 ctx）\n')

check('编译产物导出了插件四件套', () => {
  assert.equal(name, 'corum-issue-reporter')
  assert.deepEqual(inject, [])
  assert.equal(typeof apply, 'function')
  assert.equal(typeof IssueReporterService, 'function')
})

// 真实例：@Remote 元数据在构造期才盖章（见文件头），所以必须 new 出实例来读；
// 用的是全新根 ctx，不挂真插件、不注册宿主服务、构造函数无 IO。
const ctx = new Context()
const service = new IssueReporterService(ctx)
const markers = remoteMethods(service)

check('服务名 = RPC 命名空间 issueReporter', () => {
  assert.equal(service.name, 'issueReporter')
  // cordis 服务以 Proxy 暴露（isolate 包装）⇒ 比名字而不是比引用。
  assert.equal(ctx.get('issueReporter')?.name, 'issueReporter')
})

check('7 个 @Remote 端点全部注册，且 wire 形参名与规格一致', () => {
  const signatures = {}
  for (const marker of markers) {
    const exportName = marker.exportName ?? marker.method
    const implementation = service[marker.method]
    assert.equal(typeof implementation, 'function', marker.method)
    const names = gatewayParameterNames(implementation)
    assert.notEqual(names, null, `网关会拒绝 ${exportName} 的形参形态（解构/默认值/rest）`)
    signatures[exportName] = names
  }
  assert.deepEqual(signatures, {
    authStart: [],
    authPoll: ['deviceCode'],
    authStatus: [],
    signOut: [],
    ensureAssetsRepo: [],
    uploadAsset: ['name', 'base64'],
    submitIssue: ['title', 'body', 'labels'],
  })
})

check('没有任何端点把 signal 当业务形参（取消语义未被占用）', () => {
  for (const marker of markers) {
    const names = gatewayParameterNames(service[marker.method]) ?? []
    assert.equal(names.includes('signal'), false, marker.method)
  }
})

check('client_id 已配成真值（占位串守卫仍在代码里）', () => {
  assert.notEqual(GITHUB_CLIENT_ID, 'REPLACE_WITH_OAUTH_APP_CLIENT_ID')
  assert.equal(GITHUB_CLIENT_ID.startsWith('REPLACE_WITH'), false)
  assert.equal(GITHUB_CLIENT_ID.length > 0, true)
})

check('凭据 ref 过官方 CredentialRef 语法（credentialRef 不抛）', () => {
  assert.equal(/^[A-Za-z_][A-Za-z0-9_]*$/.test(TOKEN_REF), true)
  assert.equal(credentialRef(TOKEN_REF), TOKEN_REF)
})

check('目标仓库常量', () => {
  assert.deepEqual({ ...TARGET_REPO }, { owner: 'kukucaiCndy', repo: 'Corum-Harness' })
})

console.log(`\n${passed} assertions passed（0 次网络请求、0 个 token）`)
