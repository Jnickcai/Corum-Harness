/**
 * corum-ui-questions build: standalone tsdown config mirroring
 * corum-ui-chat / corum-ui-conversation / corum-ui-model-selection. The browser
 * bundle is a closure-factory artifact — it calls window.__ModuleLoader__.load({id,
 * factory}) and resolves externals through the loader module table. CSS
 * Modules are compiled by tsdown's own css pipeline and inlined into
 * client.js (scripts/inline-css.mjs folds the extracted sheet into the
 * bundle).
 *
 * Unlike corum-ui-chat, this plugin does NOT depend on the conversation layer
 * (@corum/corum-ui-conversation). It only needs session-level packages.
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ui-questions',
  client: {
    entry: 'src/client/index.tsx',
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-settings', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-api-session-controller/client', '@deepseek-ai/dsh-api-remotes/client', '@deepseek-ai/dsh-user-questions'],
    pinConditionNames: true,
  },
})
