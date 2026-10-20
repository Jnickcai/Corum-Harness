/**
 * @corum/corum-todo-guard build（host-only library）。
 *
 * 官方 dsh 包全部 external——host 从真实安装解析，与官方同版本共存。
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-todo-guard',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session-projection'],
  },
  client: false,
})
