/**
 * ide-plugin-manager build: the standard corum client-plugin bundle.
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ide-plugin-manager-ui',
  client: {
    entry: 'src/client/index.tsx',
  },
})
