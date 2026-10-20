/**
 * corum-ui-chat build: standalone tsdown config mirroring
 * corum-ui-conversation / corum-ui-model-selection. The browser bundle is a
 * closure-factory artifact — it calls window.__ModuleLoader__.load({id,
 * factory}) and resolves externals through the loader module table. CSS
 * Modules are compiled by tsdown's own css pipeline and inlined into
 * client.js (scripts/inline-css.mjs folds the extracted sheet into the
 * bundle).
 *
 * chat 对 @corum/corum-ui-conversation 仅 type-only 引用，tsc 已全部擦除，
 * 产物无对应 require，故无需列 external（与官方 ui-chat 的 tsdown 一致）。
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ui-chat',
  client: {
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-settings'],
    pinConditionNames: true,
  },
})
