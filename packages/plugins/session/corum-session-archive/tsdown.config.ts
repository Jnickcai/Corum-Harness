/**
 * session-archive build: standalone tsdown config mirroring the corum-desktop
 * client bundle. The browser bundle is a closure-factory artifact — it calls
 * window.__ModuleLoader__.load({id, factory}) and resolves externals through
 * the loader module table (react, cordis, and the dsh client platform
 * modules). CSS Modules are compiled by tsdown's own css pipeline: importing
 * `x.module.css` yields the hashed class map and the stylesheet text is
 * inlined into client.js as an injected <style> (the __ModuleLoader__ desktop
 * loader serves no CSS file).
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-session-archive',
  client: {
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'],
  },
})
