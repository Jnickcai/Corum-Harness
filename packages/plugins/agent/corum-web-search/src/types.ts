/**
 * @corum/corum-web-search 的类型面。
 *
 * 结构上满足 dsh 的 `WebSearchProvider` 契约（`id` / `available()` /
 * `search()`），另加两个**只给 corum 自己的 UI 与诊断用**的字段（label /
 * origin）——dsh 的 provider 契约里没有 display 面（`types.d.ts:98-104`），
 * 而 corum 的设置页要展示「哪些供应商可选」，所以列表信息必须由我们自己的
 * 服务记账（dsh 不提供枚举 API，见 `dsh-web/lib/index.js:51-52` 的私有 map）。
 *
 * @module @corum/corum-web-search/types
 */

import type { WebSearchProvider } from '@deepseek-ai/dsh-web'

export type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/**
 * 一个可被聚合 provider 调度的搜索子 provider。
 *
 * 与 dsh 的 `WebSearchProvider` 同形（可直接交给 dsh），只多两个描述字段。
 */
export interface WebSearchSubProvider extends WebSearchProvider {
  /** UI 展示名（中文）。 */
  readonly label: string
  /**
   * 来源：`builtin` = 本包内置（DeepSeek）；`plugin:<包名>` = 别的插件经
   * `ctx.corumWebSearch.registerSubProvider` 注册。
   */
  readonly origin: string
}

/** 子 provider 的 RPC 投影（client 半消费）。 */
export interface WebSearchSubProviderView {
  /** 注册键（就是 dsh 语义里的 provider id）。 */
  id: string
  /** UI 展示名。 */
  label: string
  /** 来源描述。 */
  origin: string
  /** 该子 provider 的**本地**可用性（它自己的 `available()`）。 */
  available: boolean
  /** 是否是当前激活项。 */
  active: boolean
}

/** `corumWebSearch/describe` 的返回：设置页渲染状态所需的全部事实。 */
export interface WebSearchStatus {
  /** 聚合 provider 在 `ctx.web` 里注册的 id（= overlay patch pin 的那个）。 */
  aggregateId: string
  /** 当前激活的子 provider id（来自 settings namespace `corum-web-search`）。 */
  activeId: string
  /** 激活项是否已在册且自报可用。 */
  activeAvailable: boolean
  /** 全部已注册子 provider（含不可用者；注册序）。 */
  subProviders: WebSearchSubProviderView[]
}
