/**
 * corum-ui-settings-models build: standalone tsdown config mirroring the
 * session-archive client bundle. The browser bundle is a closure-factory
 * artifact — it calls window.__ModuleLoader__.load({id, factory}) and resolves
 * externals through the loader module table. CSS Modules are compiled by
 * tsdown's own css pipeline: importing `x.module.css` yields the hashed class
 * map and the stylesheet text is inlined into client.js as an injected <style>.
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ui-settings-models',
  host: {
    entries: ['lib/types/index.js', 'lib/types/settings-registrar.js'],
    external: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery'],
  },
  client: {
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'],
  },
})
