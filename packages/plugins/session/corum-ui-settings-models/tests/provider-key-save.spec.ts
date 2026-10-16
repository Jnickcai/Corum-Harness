/**
 * 供应商详情页「存密钥」路径的**事故回归**单测。
 *
 * ## 事故：界面报「已保存」，密钥却永远没人读（且不可恢复）
 *
 * 详情页把输入的密钥写进**推导出来的**引用名
 * （`deriveKeyRef(provider)` → `LOCAL_API_KEY`，见 `store.ts`），却从不把
 * `apiKeyEnv` 写回 profile；而运行时**不推导**，只认 profile 里显式声明的
 * `apiKeyEnv`（pi-ai 侧 `if (ref === undefined) return undefined`）。于是：
 *
 *   - `$CORUM_HOME/.credentials.yaml` 里确实有 `LOCAL_API_KEY`，界面上却显示「未配置」；
 *   - 模型请求照旧报 `No API key for provider: local`（pi-ai 的 OpenAI 兼容 route
 *     在 `apiKey` falsy 且无 authorization 头时直接抛）；
 *   - 详情页这条路径**结构上救不回来**：每次点保存都只是再写一次那个没人读的引用。
 *
 * 根因是「同一件事有两处认知」：编辑器（`ProviderEditor` 会写 `apiKeyEnv`）与详情页
 * 各有一份「密钥该落在哪个 ref」的规则，只有一处把结果声明回 profile。
 *
 * ## 本文件钉住的不变式
 *
 * 1. 带密钥保存时 profile 会拿到 `apiKeyEnv`（值就是同一个 keyRef）；profile 已声明时不覆盖。
 * 2. profile 的写入**先提交**，credential 后写：credential 写失败只留下一个「引用了 X
 *    但 X 未设置」的诚实状态，而不是一个谁也读不到的孤儿密钥。
 * 3. 全部 profile 字段合成**一次** `settings.mutate`（避免同一函数内读到陈旧 revision）。
 * 4. `derivedCredential` 与 `credential` 一样算「已配置」——这正是事故里界面显示
 *    「未配置」的直接原因（`ProviderRow.derivedCredential` 当时全仓无人消费）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  keyConfiguredFor, keyRefFor, providerProfileOps, saveProviderProfile,
} from '../src/client/store.ts'
import type { ModelsWire, ProviderProfileEdit, ProviderRow } from '../src/client/store.ts'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

/** 一次详情页保存携带的表单值（自定义 pi-ai 路由，未声明 apiKeyEnv）。 */
const EDIT: ProviderProfileEdit = {
  settingsPath: ['providers', 'local'],
  declaredApiKeyEnv: undefined,
  keyRef: 'LOCAL_API_KEY',
  key: 'sk-typed',
  isOfficial: false,
  baseURL: 'https://gateway.example/v1',
  systemRole: false,
  systemRoleStored: false,
}

/** 一个只认「调过面 + 写进去的东西」的 wire 替身（业务码无关，两个面各有一次成败）。 */
function recorder(options: { mutateFailure?: string; setFailure?: string } = {}): {
  api: Pick<ModelsWire, 'settings' | 'credentials'>
  /** 调用序列（`mutate:<ns>` / `credentials.set`），用来断言先后顺序。 */
  calls: string[]
  ops: SettingsPathOpView[]
  /** 每次 mutate 带的 revision，用来断言「只提交一次」。 */
  revisions: Array<number | undefined>
  /** 每次 credentials.set 的 `<ref>=<value>`。 */
  stored: string[]
} {
  const calls: string[] = []
  const ops: SettingsPathOpView[] = []
  const revisions: Array<number | undefined> = []
  const stored: string[] = []
  const mutate = async (ns: string, written: readonly SettingsPathOpView[], revision?: number) => {
    calls.push(`mutate:${ns}`)
    ops.push(...written)
    revisions.push(revision)
    return options.mutateFailure === undefined
      ? { ok: true as const, value: { revision: 1, user: {} } }
      : { ok: false as const, error: { code: 'settings/invalid' as const, message: options.mutateFailure } }
  }
  const set = async (ref: string, value: string) => {
    calls.push('credentials.set')
    stored.push(`${ref}=${value}`)
    return options.setFailure === undefined
      ? { ok: true as const, value: { ref, configured: true, writable: true } }
      : { ok: false as const, error: { code: 'credentials/unavailable' as const, message: options.setFailure } }
  }
  // 只替身被调用的两个方法，故整体断言一次 Remote 命名空间的形状。
  const api = { settings: { mutate }, credentials: { set } } as unknown as Pick<ModelsWire, 'settings' | 'credentials'>
  return { api, calls, ops, revisions, stored }
}

/** 一行 provider 的最小形态（只填本组断言读得到的字段）。 */
function row(state: Partial<Pick<ProviderRow, 'apiKeyEnv' | 'credential' | 'derivedCredential'>>): ProviderRow {
  return {
    entry: {
      provider: 'local', displayName: 'Local', settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'local'], active: true,
    },
    configured: true,
    removable: true,
    apiKeyEnv: state.apiKeyEnv,
    credential: state.credential,
    ...state.derivedCredential === undefined ? {} : { derivedCredential: state.derivedCredential },
  }
}

/** 剥掉注释，避免说明性文字被当成代码判据（与 corum-ui-model-ask 同款守卫）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('providerProfileOps —— 存密钥必须同时把引用声明回 profile', () => {
  it('**回归**：填了密钥且 profile 未声明 apiKeyEnv ⇒ 一次写入里带上 apiKeyEnv = keyRef', () => {
    expect(providerProfileOps(EDIT)).toContainEqual({
      op: 'set', path: ['providers', 'local', 'apiKeyEnv'], value: 'LOCAL_API_KEY',
    })
  })

  it('profile 已声明 apiKeyEnv ⇒ 不覆盖（那是用户的既有配置）', () => {
    const ops = providerProfileOps({ ...EDIT, declaredApiKeyEnv: 'USER_OWN_KEY', keyRef: 'USER_OWN_KEY' })
    expect(ops.some(op => op.path[op.path.length - 1] === 'apiKeyEnv')).toBe(false)
  })

  it('密钥留空 ⇒ 不声明（原样保存地址不引出引用）', () => {
    const ops = providerProfileOps({ ...EDIT, key: '' })
    expect(ops.some(op => op.path[op.path.length - 1] === 'apiKeyEnv')).toBe(false)
    expect(ops).toContainEqual({ op: 'set', path: ['providers', 'local', 'baseURL'], value: 'https://gateway.example/v1' })
  })

  it('官方目录路由 ⇒ 只声明 apiKeyEnv，不写 endpoint / compat', () => {
    expect(providerProfileOps({ ...EDIT, isOfficial: true })).toEqual([
      { op: 'set', path: ['providers', 'local', 'apiKeyEnv'], value: 'LOCAL_API_KEY' },
    ])
  })
})

describe('saveProviderProfile —— profile 先落盘，credential 后写', () => {
  it('一次 mutate 写完 profile 的全部字段，且早于 credentials.set', async () => {
    const rec = recorder()
    const message = await saveProviderProfile(
      rec.api, 'llm-pi-ai', { ...EDIT, systemRole: true }, 7,
    )
    expect(message).toBeUndefined()
    expect(rec.calls).toEqual(['mutate:llm-pi-ai', 'credentials.set'])
    expect(rec.ops).toEqual([
      { op: 'set', path: ['providers', 'local', 'apiKeyEnv'], value: 'LOCAL_API_KEY' },
      { op: 'set', path: ['providers', 'local', 'baseURL'], value: 'https://gateway.example/v1' },
      { op: 'set', path: ['providers', 'local', 'compat', 'supportsDeveloperRole'], value: false },
    ])
    // 只提交一次 ⇒ 只带一个 revision（拆成多次会在同一函数里读到陈旧 revision）。
    expect(rec.revisions).toEqual([7])
    expect(rec.stored).toEqual(['LOCAL_API_KEY=sk-typed'])
  })

  it('profile 写失败 ⇒ 返回失败信息，且**一个密钥都不写**（绝不留下孤儿密钥）', async () => {
    const rec = recorder({ mutateFailure: 'settings conflict' })
    const message = await saveProviderProfile(rec.api, 'llm-pi-ai', EDIT, undefined)
    expect(message).toBe('settings conflict')
    expect(rec.calls).toEqual(['mutate:llm-pi-ai'])
    expect(rec.stored).toEqual([])
  })

  it('credential 写失败 ⇒ 返回失败信息（profile 已落盘，页面诚实显示「引用了 X 但 X 未设置」）', async () => {
    const rec = recorder({ setFailure: 'keychain unavailable' })
    const message = await saveProviderProfile(rec.api, 'llm-pi-ai', EDIT, undefined)
    expect(message).toBe('keychain unavailable')
    expect(rec.calls).toEqual(['mutate:llm-pi-ai', 'credentials.set'])
    expect(rec.ops).toContainEqual({ op: 'set', path: ['providers', 'local', 'apiKeyEnv'], value: 'LOCAL_API_KEY' })
  })

  it('未填密钥 ⇒ 不触碰 credential 面', async () => {
    const rec = recorder()
    expect(await saveProviderProfile(rec.api, 'llm-pi-ai', { ...EDIT, key: '' }, undefined)).toBeUndefined()
    expect(rec.calls).toEqual(['mutate:llm-pi-ai'])
  })
})

describe('已配置判定 —— derivedCredential 与 credential 同等有效', () => {
  it('**回归**：密钥存在推导出来的 ref 上（profile 未声明）⇒ 算已配置', () => {
    expect(keyConfiguredFor(row({
      derivedCredential: { ref: 'LOCAL_API_KEY', configured: true, writable: true },
    }))).toBe(true)
  })

  it('profile 声明的 ref 上有密钥 ⇒ 算已配置', () => {
    expect(keyConfiguredFor(row({
      apiKeyEnv: 'LOCAL_API_KEY',
      credential: { ref: 'LOCAL_API_KEY', configured: true, writable: true },
    }))).toBe(true)
  })

  it('两处都没有 ⇒ 未配置；configured 明确为 false ⇒ 仍未配置', () => {
    expect(keyConfiguredFor(row({}))).toBe(false)
    expect(keyConfiguredFor(row({
      derivedCredential: { ref: 'LOCAL_API_KEY', configured: false, writable: true },
    }))).toBe(false)
  })
})

describe('keyRefFor —— 密钥引用规则只有一处', () => {
  it('profile 声明了就用声明的，否则用推导名', () => {
    expect(keyRefFor('local', 'USER_OWN_KEY')).toBe('USER_OWN_KEY')
    expect(keyRefFor('local', undefined)).toBe('LOCAL_API_KEY')
    expect(keyRefFor('minimax-cn', '')).toBe('MINIMAX_CN_API_KEY')
  })
})

describe('详情页接线（防回退：不得再各写一份规则）', () => {
  const detail = stripComments(readFileSync(join(import.meta.dirname, '../src/client/ProviderDetailView.tsx'), 'utf8'))

  it('保存路径走 saveProviderProfile（含 apiKeyEnv 声明与写入顺序）', () => {
    expect(detail).toContain('saveProviderProfile(api,')
  })

  it('已配置判定走 keyConfiguredFor（同时认 credential 与 derivedCredential）', () => {
    expect(detail).toContain('keyConfiguredFor(provider.row)')
    expect(detail).not.toContain('credential?.configured')
  })

  it('引用名走 keyRefFor（不再自算一份推导）', () => {
    expect(detail).toContain('keyRefFor(provider.provider, provider.apiKeyEnv)')
  })
})
