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
import { defineConfig } from 'tsdown'

/** Module-table entries the desktop seed answers: kept external in the browser bundle. */
const CLIENT_EXTERNALS: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-connection',
]

const CLIENT_ID = '@corum/corum-web-search'

export default defineConfig(() => [
  // Node library entry (tsc-emitted from lib/types).
  {
    name: CLIENT_ID,
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/schemastery',
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-launch-environment',
      '@deepseek-ai/dsh-settings',
      '@deepseek-ai/dsh-typert-protocol',
      '@deepseek-ai/dsh-web',
      '@deepseek-ai/dsh-web-search-deepseek',
    ],
  },
  // Browser bundle: the settings-section client half.
  {
    name: `${CLIENT_ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    css: { splitting: false },
    outputOptions: {
      entryFileNames: 'client.js',
      inlineDynamicImports: true,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
