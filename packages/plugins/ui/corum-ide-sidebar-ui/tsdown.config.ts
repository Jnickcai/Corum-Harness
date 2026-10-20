/**
 * ide-sidebar build: the standard corum client-plugin bundle
 * (closure-factory artifact over window.__ModuleLoader__, externals resolved
 * through the loader module table, CSS inlined by scripts/inline-css.mjs).
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ide-sidebar-ui',
  client: {
    extraExternals: ['anser', 'anser', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'],
  },
})
