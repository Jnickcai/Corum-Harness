/**
 * corum-ui-trajectory build: standalone tsdown config mirroring the other corum
 * UI forks. The browser bundle is a closure-factory artifact — it calls
 * window.__ModuleLoader__.load({id, factory}) and resolves externals through the
 * loader module table. CSS Modules are compiled by tsdown's own css pipeline and
 * inlined into client.js (scripts/inline-css.mjs folds the extracted sheet in).
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ui-trajectory',
  client: {
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'],
  },
})
