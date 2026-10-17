/**
 * 聚合 provider 的调度内核（纯逻辑，不依赖 cordis）。
 *
 * 为什么需要它：dsh 的 provider 选择**只在 `WebRuntime` 构造时读一次**
 * （`dsh-web/lib/index.js:57`，来源是插件 config 或 `$DSH_WEB_SEARCH_PROVIDER`），
 * 没有任何运行时切换面；而官方 `deepseek-official` 的 `available()` 恒为 true
 * （同文件 100-103 判的是「resolveApiKey 存在」，与有没有 Key 无关）⇒ 一旦摘掉
 * pin 再启用第二个 provider，立刻 `WEB_PROVIDER_AMBIGUOUS`（同文件 130）。
 *
 * 所以 corum 的做法是：把 pin 钉在**自己的**聚合 provider 上（一个 id 永远在册、
 * 永远可用），把「用哪个供应商」变成聚合 provider 内部的一个**每次调用现读**的
 * settings 值。于是切换即时生效、不需要重启、也不可能 AMBIGUOUS。
 *
 * @module @corum/corum-web-search/aggregate
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { WebSearchSubProvider } from './types.ts'

/** 聚合 provider 的构造参数。 */
export interface AggregateWebSearchOptions {
  /** 本聚合 provider 在 `ctx.web` 里注册的 id（dsh 用它做注册键与 pin 匹配）。 */
  readonly aggregateId: string
  /**
   * 当前激活的子 provider id。**每次调用现读**（不是构造时快照）——这正是
   * 「改完设置立刻生效、不需要重注册 provider」的实现点。
   */
  readonly activeId: () => string
}

/**
 * 一个把搜索委托给「当前激活子 provider」的 dsh 搜索 provider。
 *
 * 它自己不做任何网络调用、不持有凭据；子 provider 的注册面是
 * {@link register}，由上层 cordis 服务 `corumWebSearch` 暴露给其它插件。
 */
export class AggregateWebSearch implements WebSearchProvider {
  /** dsh 注册键（= overlay patch 里 pin 的值）。 */
  readonly id: string

  private readonly options: AggregateWebSearchOptions
  private readonly subProviders = new Map<string, WebSearchSubProvider>()

  /**
   * @param options - 聚合 id 与激活项读取面。
   */
  constructor(options: AggregateWebSearchOptions) {
    this.options = options
    this.id = options.aggregateId
  }

  /**
   * 注册一个子 provider。id 重复**大声失败**（与 `ctx.web` 的
   * `WEB_DUPLICATE_PROVIDER` 同一纪律：静默覆盖会让「谁在服务这次搜索」不可追）。
   *
   * @param provider - 子 provider（`id` 是注册键）。
   * @returns 注销它的 disposer。
   * @throws {WebError} `WEB_DUPLICATE_PROVIDER` 当 id 已在册。
   */
  register(provider: WebSearchSubProvider): () => void {
    if (this.subProviders.has(provider.id)) {
      throw new WebError(
        `a corum web-search sub provider with id "${provider.id}" is already registered`,
        'WEB_DUPLICATE_PROVIDER',
      )
    }
    this.subProviders.set(provider.id, provider)
    return () => {
      this.subProviders.delete(provider.id)
    }
  }

  /** 全部已注册子 provider（注册序）。 */
  list(): readonly WebSearchSubProvider[] {
    return [...this.subProviders.values()]
  }

  /** 当前激活的子 provider；未注册时 undefined。 */
  active(): WebSearchSubProvider | undefined {
    return this.subProviders.get(this.options.activeId())
  }

  /**
   * 廉价本地检查：**至少有一个**子 provider 自报可用。绝不做网络调用（dsh 契约
   * `types.d.ts:100` 明令禁止在 `available()` 里联网）。
   *
   * 刻意**不是**「激活项可用」：dsh 对被 pin 的 provider 只会抛
   * `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`（既不说是哪个子 provider，也不说怎么
   * 修），把判定留到 {@link search} 里能给出指名道姓的错误；同时保证 pin 在常态
   * 下一定可解析（这是「不会 AMBIGUOUS / 不会 UNAVAILABLE」的前提）。
   *
   * @returns 是否存在至少一个本地自报可用的子 provider。
   */
  available(): boolean {
    for (const provider of this.subProviders.values()) {
      if (provider.available()) return true
    }
    return false
  }

  /**
   * 把一次搜索委托给当前激活的子 provider。
   *
   * 不静默回落：激活项不可用 / 未注册时**报错**并指名道姓，而不是偷偷换成另一个
   * 供应商跑（用户显式选过的东西不能被机制替他改）。
   *
   * @param request - dsh 的搜索请求（query + 可选 maxResults）。
   * @param signal - 取消信号，原样转发给子 provider。
   * @returns 子 provider 的结果（`maxResults` 截断由 dsh 的 seam 负责）。
   * @throws {WebError} `WEB_PROVIDER_CONFIGURED_MISSING`（激活项未注册）/
   *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`（激活项自报不可用）。
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const id = this.options.activeId()
    const provider = this.subProviders.get(id)
    if (provider === undefined) {
      throw new WebError(
        `corum web search: the active sub provider "${id}" is not registered `
        + `(registered: ${this.keys().join(', ') || 'none'}); enable its plugin or pick another one in `
        + 'Settings > Extensions > Web search',
        'WEB_PROVIDER_CONFIGURED_MISSING',
      )
    }
    if (!provider.available()) {
      throw new WebError(
        `corum web search: the active sub provider "${id}" (${provider.label}) reports itself `
        + 'unavailable; finish its configuration or pick another one in Settings > Extensions > Web search',
        'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }
    return provider.search(request, signal)
  }

  /** 已注册 id（注册序），用于诊断文案。 */
  private keys(): string[] {
    return [...this.subProviders.keys()]
  }
}
