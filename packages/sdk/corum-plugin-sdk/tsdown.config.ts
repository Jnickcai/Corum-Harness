import { defineConfig } from 'tsdown'

/**
 * SDK 是**库**，不是被装载的插件：两份入口都是普通 ESM（node / browser），
 * 不打 `__ModuleLoader__` 闭包。
 *
 * `@corum/*` 与平台模块保持 external —— SDK 只聚合，不复制被聚合的东西：
 * 打进来就会与消费者自己解析到的那份形成双实例（`Symbol()` 不相等那类故障）。
 */
const EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@corum/corum-ui-base',
  '@corum/corum-ui-base/client',
  '@corum/corum-rpc-client',
  '@corum/corum-rpc-client/client',
]

export default defineConfig(() => [
  {
    name: '@corum/plugin-sdk',
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: EXTERNAL,
  },
  {
    name: '@corum/plugin-sdk/client',
    entry: ['lib/types/client.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: EXTERNAL,
  },
])
