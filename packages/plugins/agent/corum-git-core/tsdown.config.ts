import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-git-core',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-typert-protocol', '@corum/corum-api-remotes'],
  },
  client: false,
})
