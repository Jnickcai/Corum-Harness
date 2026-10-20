/**
 * corum-ui-model-ask build: standalone tsdown config mirroring
 * corum-ui-questions / corum-ui-approval. The browser bundle is a
 * closure-factory artifact — it calls window.__ModuleLoader__.load({id,
 * factory}) and resolves externals through the loader module table. CSS
 * Modules are compiled by tsdown's own css pipeline and inlined into
 * client.js (scripts/inline-css.mjs folds the extracted sheet into the
 * bundle).
 *
 * Unlike corum-ui-questions, this plugin does NOT need the conversation
 * layer (@corum/corum-ui-conversation): the decision panel renders straight
 * into the input dock and reads its own pending state.
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ui-model-ask',
  client: {
    entry: 'src/client/index.tsx',
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-api-session-controller/client', '@deepseek-ai/dsh-api-remotes/client'],
    pinConditionNames: true,
  },
})
