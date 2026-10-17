/**
 * @corum/corum-web-search test config。
 *
 * 只跑本包 tests/：聚合 provider 的调度语义（默认子 provider / 切换激活项 /
 * available() 不做网络调用 / 重复 id / 失败码）都不依赖真实 cordis 装配，
 * 用假子 provider 直接断言。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
