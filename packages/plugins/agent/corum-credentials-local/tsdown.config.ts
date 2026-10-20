import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-credentials-local',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-atomic-write', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-home-paths', '@deepseek-ai/dsh-launch-environment', '@deepseek-ai/schemastery', 'chokidar', 'yaml'],
  },
  client: false,
})
