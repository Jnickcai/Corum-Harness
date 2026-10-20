/**
 * @corum/corum-orchestration build: host-only library（无 client 半）。单入口
 * lib/types/index.js（apply 行 + re-export orchestration.ts 全部纯函数/类型/
 * domain）。官方 dsh 包全部 external——host 从真实安装解析，与官方 seam 同版本
 * 共存（照 corum-tool-subagent 模板）。
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-orchestration',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-storage-domain', '@deepseek-ai/dsh-subagent', 'zod'],
  },
  client: false,
})
