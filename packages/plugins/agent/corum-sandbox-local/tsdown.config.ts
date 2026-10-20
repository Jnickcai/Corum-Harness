import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-sandbox-local',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-sandbox', '@deepseek-ai/dsh-sandbox-windows-acl', '@deepseek-ai/dsh-util-values', '@deepseek-ai/node-addon-system', '@deepseek-ai/schemastery'],
  },
  client: false,
})
