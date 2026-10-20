import { definePluginBundle } from '@corum/plugin-build'

/**
 * 第三方形态的构建配置：banner / footer / externals / CSS 内联全由
 * `@corum/plugin-build` 保证（见 docs/PLUGIN-SPEC.md §7）。本插件额外把
 * 官方 renderer 的 slots 类型面放进 externals 由构建包的基础集负责。
 */
export default definePluginBundle({ id: '@corum-examples/region-replacement', client: {} })
