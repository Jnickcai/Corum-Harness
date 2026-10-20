/**
 * corum-ui-approval build: standalone tsdown config mirroring
 * corum-ui-chat / corum-ui-conversation. The browser bundle is a
 * closure-factory artifact — it calls window.__ModuleLoader__.load({id,
 * factory}) and resolves externals through the loader module table. CSS
 * Modules are compiled by tsdown's own css pipeline and inlined into
 * client.js (scripts/inline-css.mjs folds the extracted sheet into the
 * bundle).
 *
 * The fork's conversation layer is the sibling workspace package
 * @corum/corum-ui-conversation: its client half is requested from the module
 * table under that id (the fork bundle registers itself there), so it stays
 * external here instead of being inlined.
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ui-approval',
  client: {
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@corum/corum-ui-conversation', '@corum/corum-ui-conversation/client'],
    pinConditionNames: true,
  },
})
