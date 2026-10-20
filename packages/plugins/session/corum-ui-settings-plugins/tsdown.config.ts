/**
 * @corum/corum-ui-settings-plugins build: 照 corum-ui-chat 的 client bundle
 * 形态（closure-factory + inline-css）。host 半 = 官方 src/index.ts（逐字节
 * 相同，纯 re-export）；client 半 = src/client/index.ts（fork 改造：移除
 * SubagentModelSelectionCard 注册）。
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-ui-settings-plugins',
  client: {
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-settings'],
    cssMode: 'default',
  },
})
