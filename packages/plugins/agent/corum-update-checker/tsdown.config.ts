import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-update-checker',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-typert-protocol'],
  },
  client: false,
})
