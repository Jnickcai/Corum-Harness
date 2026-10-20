import { defineConfig } from 'tsdown'

/**
 * @corum/plugin-build 自己的构建：宿主半（ESM / node）。
 *
 * 它**不**吃自己的 `clientConfig`（那套是给插件包的），所以这里手写一份最小配置 ——
 * 工具包不 dogfood 自己的客户端契约是刻意的：契约里没有「工具包也要被 loader 装载」这回事。
 */
export default defineConfig(() => [
  {
    name: '@corum/plugin-build',
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: ['tsdown'],
  },
])
