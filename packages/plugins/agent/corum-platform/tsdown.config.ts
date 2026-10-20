import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-platform',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-typert-protocol'],
  },
  client: false,
})
