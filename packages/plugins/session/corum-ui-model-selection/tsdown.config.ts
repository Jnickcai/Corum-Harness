/**
 * corum-ui-model-selection build: standalone tsdown config mirroring the
 * session-archive / corum-ui-settings-models client bundle. The browser bundle
 * is a closure-factory artifact — it calls window.__ModuleLoader__.load({id,
 * factory}) and resolves externals through the loader module table. CSS
 * Modules are compiled by tsdown's own css pipeline and inlined into client.js.
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ui-model-selection',
  client: {
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'],
  },
})
