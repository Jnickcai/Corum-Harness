/**
 * 「web 搜索 provider 的凭据引用」这条规则的**唯一家**。
 *
 * 规则本身：settings section 里显式声明的 `apiKeyEnv` 优先，否则回落到 provider
 * 自己解析时使用的环境变量名常量。
 *
 * 收敛前这条规则在本仓有第三份拷贝
 * （`corum-ui-settings-plugins/src/client/web-search-card-controller.ts` 的
 * 局部 `refOf()`，已随那张卡的注册一并删除）；另两份在 `corum-ui-settings-models`
 * 的 `keyRefFor` / `apiKeyEnvOf`。**不要**把二者合并：`keyRefFor` 的规则是
 * `named ?? <PROVIDER>_API_KEY`（按 provider 名推导），与这里的固定常量语义不同。
 *
 * 放在 `@corum/corum-ui-base/client` 而不是某个设置页里：该包是本仓唯一被跨
 * bundle **值** import 的 client 面（实证 `corum-ide-plugin-manager-ui/src/
 * client/index.tsx`），tsdown 能把这份源码内联进每个消费方 bundle；而跨 client
 * 包的值 import 会被 tsdown 解析失败（同教训：client bundle 之间只敢 type-only
 * import）。
 *
 * @module @corum/corum-ui-base/client/web-search-credential
 */

/**
 * 官方 `@deepseek-ai/dsh-web-search-deepseek` provider 在 settings section 未声明
 * `apiKeyEnv` 时解析的凭据引用（它的 `DEFAULT_API_KEY_ENV`，未导出，此处按同一
 * 事实重声明）。
 */
export const DEFAULT_WEB_SEARCH_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** 参与凭据引用判定的 settings section 窄化面。 */
export interface WebSearchCredentialSection {
  /** section 声明的凭据引用；缺省/空串 = 用 provider 默认。 */
  apiKeyEnv?: string
}

/**
 * 一个 web 搜索 settings section 实际寻址的凭据引用。
 * @param section - 当前 section 值（namespace 未注册时可能为 undefined）。
 * @returns 要寻址的引用名。
 */
export function webSearchCredentialRef(
  section: WebSearchCredentialSection | undefined | null,
): string {
  const declared = section?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_WEB_SEARCH_API_KEY_REF
}
