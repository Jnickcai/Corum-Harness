/**
 * @corum/corum-web-search build: host library + browser client bundle.
 *
 * 形态与 corum-ollama / corum-memory 一致：
 *   - host 半（lib/index.js）：聚合 provider + cordis 服务 corumWebSearch，官方
 *     包（dsh-web / dsh-web-search-deepseek / dsh-settings / dsh-credentials /
 *     dsh-launch-environment）保持 external——它们在桌面闭包里由 dsh-base 提供。
 *   - client 半（lib/client.js）：注册「设置 → 扩展 → 联网搜索」section。
 *
 * ⚠️ 构建是**三步**（红线 6）：`tsc -b && tsdown && node scripts/inline-css.mjs`。
 * 本包自己没有任何 `*.module.css`，但 client 半值 import 了
 * `@corum/corum-ui-base/client`（借那条凭据引用规则的唯一家
 * `webSearchCredentialRef`），而该入口带 CSS ⇒ tsdown 会把规则文本抽到
 * `lib/style.css`，只有 inline-css 这一步能把它变成 client.js 内的 <style> 注入
 * （加载器不提供独立 CSS 资源，只跑 tsdown 等于样式全丢）。
 */
import { definePluginBundle } from '@corum/plugin-build'

export default definePluginBundle({
  id: '@corum/corum-web-search',
  host: {
    external: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-launch-environment', '@deepseek-ai/dsh-settings', '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/dsh-web', '@deepseek-ai/dsh-web-search-deepseek'],
  },
  client: {
    entry: 'src/client/index.tsx',
    extraExternals: ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-connection'],
  },
})
