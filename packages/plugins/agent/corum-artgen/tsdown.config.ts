/**
 * @corum/corum-artgen build: host library + browser client bundle.
 * The client half registers the plugin's settings section into「扩展」.
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-artgen',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-typert-protocol'],
  },
  client: {
    entry: 'src/client/index.tsx',
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-connection'],
  },
})
