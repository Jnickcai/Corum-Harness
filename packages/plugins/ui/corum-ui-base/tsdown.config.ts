/**
 * shell-base build: standalone tsdown config mirroring the ide-shell client
 * bundle. The browser bundle is a closure-factory artifact — it calls
 * window.__ModuleLoader__.load({id, factory}) and resolves externals through
 * the loader module table (react, cordis, and the dsh client platform
 * modules). CSS (module + global) is compiled by tsdown's own css pipeline
 * and inlined into client.js by scripts/inline-css.mjs (the __ModuleLoader__
 * desktop loader serves no CSS file).
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ui-base',
  client: {
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-theme/client'],
  },
})
