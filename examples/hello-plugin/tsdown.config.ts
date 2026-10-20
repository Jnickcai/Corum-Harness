import { definePluginBundle } from '@corum/plugin-build'

/**
 * 第三方的构建配置就这一份：`definePluginBundle` 管掉 banner/footer/externals/
 * CSS 内联那些「抄错一个字节就装不上」的部分（见 docs/PLUGIN-SPEC.md §7）。
 */
export default definePluginBundle({ id: '@corum-examples/hello-plugin', client: {} })
