import { defineConfig } from 'tsdown'

/**
 * 契约包是**纯库**（类型 + 两个薄 helper），两份入口都不打闭包：
 * 它被插件在构建期 import，闭包形态（`__ModuleLoader__`）是「被装载插件」的产物形态。
 *
 * `@deepseek-ai/*` 与 react 全部 external：契约只声明形状，不复制任何实现。
 */
const EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-settings/client',
  'react',
]

export default defineConfig(() => [
  {
    name: '@corum/plugin-ui-contract',
    entry: ['lib/types/index.js'],
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
