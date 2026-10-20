import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-fs-local',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-fs', '@deepseek-ai/schemastery', 'koffi'],
  },
  client: false,
})
