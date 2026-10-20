#!/usr/bin/env node
/**
 * corum-plugin-init —— 一条命令生成一个**能立刻构建**的插件骨架（随 `@corum/plugin-sdk` 发布）。
 *
 * ## 为什么要有它（写文档不如给可运行的骨架）
 *
 * 「插件怎么写」这件事最容易死在**开头**：exports 词典、dsh.client 与 ./client 的配对、
 * 三步构建、依赖分层（SDK 在 deps、基座在 peer）、`files` 里必须带 `cordis.patch.yml`……
 * 任何一处写错都不是报错，而是「构建过了但装不上 / 装上了但样式全丢 / 装了但看不见」。
 *
 * 骨架把这些**已经踩过的坑**固化下来，开发者（含 Agent）从第一分钟起就在正确形状上。
 *
 * ## 用法
 *
 *   npx corum-plugin-init --name @you/my-plugin --dir my-plugin          # 第三方：独立工程
 *   npx corum-plugin-init --name @you/my-api --dir my-api --kind k1      # 只有宿主半
 *   node scripts/create-plugin.mjs --name @you/x --dir examples/x        # 本仓内（走 --repo）
 *
 * `--kind k2`（缺省）= 双半插件（宿主半 + 客户端半，可覆盖区域、加设置页）；
 * `--kind k1` = 只有宿主半（注册服务/工具，无 UI）。
 *
 * 两种模式：
 * - **standalone（缺省，第三方用）**：`dependencies` 写真实版本 `^0.6.0`，`tsconfig.json` 自包含
 *   （不 extends 本仓的 `tsconfig.base.json`）—— 生成的是能独立 `pnpm install && pnpm build` 的包；
 * - **repo（本仓内用，`--repo`）**：依赖用 `workspace:*`、tsconfig extends 仓库基座，
 *   生成到 `examples/<name>` 直接进 pnpm workspace。
 *
 * @module @corum/plugin-sdk/bin/corum-plugin-init
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** standalone = 第三方独立工程（真实版本号 + 自包含 tsconfig）；repo = 本仓 workspace 内。 */
const STANDALONE = !process.argv.includes('--repo')
const ROOT = STANDALONE ? process.cwd() : resolve(import.meta.dirname, '../../../..')

function arg(name, fallback) {
  const inline = process.argv.find(a => a.startsWith(`--${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1]
  return fallback
}

const name = arg('name')
const dirArg = arg('dir')
const kind = arg('kind', 'k2')
if (name === undefined || !/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(name)) {
  console.error('✗ 需要 --name @scope/kebab-name（全小写连字符，形如 @you/my-plugin）')
  process.exit(2)
}
if (dirArg === undefined) {
  console.error('✗ 需要 --dir（建议 examples/<name>，会在里面生成骨架）')
  process.exit(2)
}
if (kind !== 'k1' && kind !== 'k2') {
  console.error('✗ --kind 只能是 k1（只有宿主半）或 k2（双半）')
  process.exit(2)
}

const dir = resolve(ROOT, dirArg)
if (existsSync(join(dir, 'package.json'))) {
  console.error(`✗ ${dirArg} 里已有 package.json，拒绝覆盖`)
  process.exit(2)
}
const slug = name.split('/')[1]
const camel = slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
const service = `${camel}Service`

const files = []

function write(rel, content) {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  files.push(rel)
}

// ── package.json ──────────────────────────────────────────────────────────
const manifest = {
  name,
  version: '0.1.0',
  private: true,
  description: `${name} —— corum 插件（${kind === 'k2' ? '宿主半 + 客户端半' : '仅宿主半'}）。由 scripts/create-plugin.mjs 生成。`,
  license: 'Apache-2.0',
  type: 'module',
  exports: {
    '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
    ...(kind === 'k2' ? { './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' } } : {}),
    './package.json': './package.json',
  },
  ...(kind === 'k2'
    ? { dsh: { client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-slots'] }, bundle: { patch: 'cordis.patch.yml' } } }
    : { dsh: { bundle: { patch: 'cordis.patch.yml' } } }),
  corum: { plugin: { api: 1, host: '>=0.6.0 <0.7.0', kind: 'bundle' } },
  // ⚠️ `cordis.patch.yml` **必须**在 files 里：漏了它，打包产物就没有挂载层，
  // 启动预检会以 bad-patch 跳过插件（骨架第一版就这么被挡下来过）。
  files: ['lib', 'cordis.patch.yml', 'README.md'],
  scripts: {
    build: kind === 'k2' ? 'tsc -b && tsdown && corum-inline-css' : 'tsc -b && tsdown',
    typecheck: 'tsc -b --pretty false && tsc -p tsconfig.spec.json --noEmit --pretty false',
    test: 'vitest run',
  },
  dependencies: {
    '@corum/plugin-sdk': STANDALONE ? '^0.6.0' : 'workspace:*',
    // 双半插件要注册区域/设置页 ⇒ 必装 UI 契约（k1 不需要）。
    ...(kind === 'k2' ? { '@corum/plugin-ui-contract': STANDALONE ? '^0.6.0' : 'workspace:*' } : {}),
  },
  peerDependencies: { '@deepseek-ai/cordis': '^4.0.1', ...(kind === 'k2' ? { react: '^18.2.0' } : {}) },
  devDependencies: {
    '@corum/plugin-build': STANDALONE ? '^0.6.0' : 'workspace:*',
    '@deepseek-ai/cordis': '^4.0.1',
    ...(kind === 'k2' ? { '@deepseek-ai/dsh-client-ui-renderer': '^0.1.5-rc.3', '@deepseek-ai/dsh-client-ui-slots': '^0.1.5-rc.3', '@types/react': '~18.3.31', react: '^18.2.0' } : {}),
    tsdown: '^0.22.2',
    typescript: '^6.0.3',
    vitest: '^5.0.0',
  },
}
write('package.json', `${JSON.stringify(manifest, null, 2)}\n`)

// ── 构建与类型配置 ────────────────────────────────────────────────────────
// standalone 不 extends 本仓基座（那是仓库内部的相对路径，第三方没有）。
const baseCompilerOptions = STANDALONE
  ? {
      target: 'es2024',
      module: 'esnext',
      moduleResolution: 'bundler',
      strict: true,
      declaration: true,
      sourceMap: true,
      skipLibCheck: true,
      composite: true,
      exactOptionalPropertyTypes: true,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
    }
  : {}
write('tsconfig.json', `${JSON.stringify({
  ...(STANDALONE ? {} : { extends: '../../tsconfig.base.json' }),
  compilerOptions: {
    ...baseCompilerOptions,
    rootDir: 'src',
    outDir: 'lib/types',
    // 构建缓存别落进 lib/：否则它会跟着 `files: ["lib"]` 一起发到 npm（实测产物里出现过
    // tsconfig.tsbuildinfo）。放到包根、由一个点文件承载即可。
    tsBuildInfoFile: '.tsbuildinfo',
    ...(kind === 'k2' ? { jsx: 'react-jsx', lib: ['ES2024', 'DOM', 'DOM.Iterable'] } : { lib: ['ES2024'] }),
    types: [],
  },
  include: ['src'],
}, null, 2)}\n`)

write('tsconfig.spec.json', `${JSON.stringify({
  extends: './tsconfig.json',
  compilerOptions: { rootDir: '../..', composite: false, incremental: false, declaration: false, sourceMap: false, noEmit: true, rewriteRelativeImportExtensions: false },
  include: ['src', 'tests'],
}, null, 2)}\n`)

write('tsdown.config.ts', kind === 'k2'
  ? `import { definePluginBundle } from '@corum/plugin-build'

/**
 * 构建契约只有这一份：banner/footer/externals/CSS 内联全由 @corum/plugin-build 保证。
 * 手抄这些是「抄错一个字节就装不上、且报错指向别处」的那类事故（docs/PLUGIN-SPEC.md §7）。
 */
export default definePluginBundle({ id: '${name}', client: {} })
`
  : `import { definePluginBundle } from '@corum/plugin-build'

/** 仅宿主半：client: false（没有客户端半 ⇒ 也就没有 \`./client\` 出口与 dsh.client）。 */
export default definePluginBundle({ id: '${name}', client: false })
`)

// ── 挂载层 ────────────────────────────────────────────────────────────────
write('cordis.patch.yml', `# 挂载层：\`insert\` 不带 id ⇒ 直接追加到组件树根，**不需要知道宿主任何 row id**。
# 客户端半是按 loader 条目供应的：没有这一行，插件不会被装载（哪怕它构建出了 client.js）。
- insert:
    - id: ${slug}
      name: '${name}'
`)

// ── 宿主半 ────────────────────────────────────────────────────────────────
write('src/index.ts', `/**
 * ${name} —— 宿主半。
 *
 * 宿主半能做的三件事（按需要删掉不用的）：
 * 1. 注册 cordis 服务（\`ctx.provide\`），供别的插件/本插件客户端半使用；
 * 2. 注入官方服务（在 \`inject\` 里声明）—— 注意红线 4：未 inject 的属性访问会抛；
 * 3. **给 Agent 加工具**（\`registerAgentTool\`）—— 这是插件最"有意义"的能力面。
 *
 * @module ${name}
 */

import { defineAgentTool, definePlugin, registerAgentTool } from '@corum/plugin-sdk'
import type { Context } from '@corum/plugin-sdk'

/** 插件名：与包名后缀一致（cordis 用它给服务与日志打标）。 */
export const name = '${slug}'

/** 依赖的宿主服务。要用工具就加 'tools'；要用会话资源就加 'tools' 之外的（按需）。 */
export const inject: string[] = []

/**
 * 装配。**不要**在模块作用域做副作用（cordis 会多次 reload）。
 * @param ctx - 宿主根上下文。
 */
export function apply(ctx: Context): void {
  ctx.provide('${service}', {
    /** 一个最小的可观测事实：证明插件真的挂上了。 */
    hello: (): string => '${name} is mounted',
  })

  // ── 给 Agent 加一个工具（想用就把这几行取消注释，并在 inject 里加 'tools'）──
  // ctx.effect(() => registerAgentTool(ctx.tools, defineAgentTool({
  //   name: '${slug}_echo',
  //   description: 'Echo the given text. Replace this with something useful.',
  //   parameters: { text: { type: 'string', required: true, description: 'Text to echo.' } },
  //   output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
  //   async execute(args) { return args.text },
  // })))
}

export default definePlugin({ name, inject, apply })
`)

// ── 客户端半 ──────────────────────────────────────────────────────────────
if (kind === 'k2') {
  write('src/client/index.ts', `/**
 * ${name} —— 客户端半。
 *
 * 契约只允许两处 UI（\`@corum/plugin-ui-contract\`）：
 * ① **覆盖右侧区域**（corum.editor / corum.trajectory / corum.panel）；
 * ② **在 设置 ›「扩展」里加一页**。
 *
 * 布局归壳：不要调 \`showRegion\` / \`setRegionHidden\` / \`toggleRegion\` / \`resetLayout\` /
 * \`closeRegion\` —— 插件接管区域后，壳会自动点亮它（\`scripts/verify-plugin-ui-surface.mjs\` 会拦）。
 *
 * @module ${name}/client
 */

import type { Context } from '@corum/plugin-sdk/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  registerRegionOverride,
  registerSettingsSection,
} from '@corum/plugin-ui-contract'
import { Panel } from './Panel.tsx'
import { SettingsPage } from './SettingsPage.tsx'

/** 依赖的客户端服务：槽注册表（\`layout\` 不声明 —— 布局归壳）。 */
export const inject = ['slots']

/** 设置页 section id（不要在壳已知表里 ⇒ 自动落进「扩展」分组）。 */
export const SETTINGS_SECTION_ID = '${slug}.settings'

/**
 * 装配。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: Context): void {
  // ① 覆盖「编辑器」区域（要换区域就改 slot 值；三个可选值见契约包 REGION_OVERRIDE_SLOTS）
  registerRegionOverride(ctx.slots, { slot: 'corum.editor', Component: Panel })

  // ② 设置 › 扩展 里加一页
  registerSettingsSection(ctx.slots, {
    id: SETTINGS_SECTION_ID,
    label: () => '${slug}',
    Component: SettingsPage,
  })
}
`)

  write('src/client/Panel.tsx', `/**
 * ${name} —— 区域面板（覆盖 \`corum.editor\`）。
 *
 * 主题一律走 CSS 变量（\`--corum-glass-*\` / \`--dsw-alias-*\`），颜色/字号不写死：
 * 壳的深浅色与密度是按这些 token 切换的。
 *
 * @module ${name}/client/Panel
 */

const S = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px 16px',
    height: '100%',
    minHeight: 0,
    overflow: 'auto',
    font: '13px/1.7 Inter, -apple-system, "PingFang SC", sans-serif',
    color: 'var(--dsw-alias-label-primary)',
  },
  card: {
    padding: '10px 12px',
    borderRadius: '12px',
    background: 'var(--corum-glass-1)',
    border: '1px solid var(--corum-glass-border)',
  },
  hint: { margin: 0, fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' },
} as const

/** 区域内容。 */
export function Panel(): React.JSX.Element {
  return (
    <div style={S.body} data-plugin-panel="${slug}">
      <div style={S.card}>
        <strong>${name}</strong>
        <p style={S.hint}>
          这块区域原来的 occupant 已被本插件用 slot priority 遮蔽接管；卸载插件后原 occupant 自动回来。
          改我：<code>src/client/Panel.tsx</code>。
        </p>
      </div>
    </div>
  )
}
`)

  write('src/client/SettingsPage.tsx', `/**
 * ${name} —— 设置 › 扩展 里的一页。
 * @module ${name}/client/SettingsPage
 */

import type { SettingsSectionOwnerProps } from '@corum/plugin-ui-contract'

const S = {
  page: { display: 'flex', flexDirection: 'column', gap: '10px', color: 'var(--dsw-alias-label-primary)' },
  card: {
    padding: '12px 14px',
    borderRadius: '12px',
    background: 'var(--corum-glass-1)',
    border: '1px solid var(--corum-glass-border)',
  },
  hint: { margin: 0, fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' },
} as const

/**
 * 设置页。
 * @param _props - 壳下发的 owner props（\`close\` 等）+ 本插件 inject 面（此处未用）。
 * @returns 页面内容。
 */
export function SettingsPage(_props: SettingsSectionOwnerProps): React.JSX.Element {
  return (
    <div style={S.page} data-settings-page="${slug}">
      <div style={S.card}>
        <strong>${name}</strong>
        <p style={S.hint}>本页由插件注册到 \`settings.section\`；改我：<code>src/client/SettingsPage.tsx</code>。</p>
      </div>
    </div>
  )
}
`)
}

// ── 测试 ──────────────────────────────────────────────────────────────────
write('tests/plugin-shape.spec.ts', `import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/index.ts'

/**
 * 冒烟判据：入口契约的形状不能坏。
 * 官方 loader 依赖 \`name\` / \`inject\` / \`apply\` 三个导出；写错不会报错，只会让插件静默不生效。
 */
describe('宿主入口契约', () => {
  it('导出 name / inject / apply', () => {
    expect(name).toBe('${slug}')
    expect(Array.isArray(inject)).toBe(true)
    expect(typeof apply).toBe('function')
  })

  it('apply 会 provide 本插件的服务', () => {
    const provided: string[] = []
    apply({
      provide: (key: string) => { provided.push(key) },
      effect: (factory: () => (() => void) | void) => factory(),
      logger: { info: () => undefined },
      get: () => undefined,
    } as never)
    expect(provided).toContain('${service}')
  })
})
`)

// ── README ────────────────────────────────────────────────────────────────
write('README.md', `# ${name}

由 \`node scripts/create-plugin.mjs\` 生成。**从这里开始改**：

| 想做什么 | 改哪里 |
|---|---|
| 插件在宿主里提供什么服务 / 注册什么工具 | \`src/index.ts\` |
| ${kind === 'k2' ? '覆盖哪个区域 / 区域里画什么' : '（本骨架只有宿主半，没有 UI）'} | ${kind === 'k2' ? '\`src/client/index.ts\` / \`src/client/Panel.tsx\`' : '—'} |
| ${kind === 'k2' ? '设置 › 扩展里的页面' : ''} | ${kind === 'k2' ? '\`src/client/SettingsPage.tsx\`' : '—'} |
| 挂到组件树哪一行 | \`cordis.patch.yml\` |

## 本地验证

\`\`\`bash
pnpm install
pnpm --filter ${name} run typecheck
pnpm --filter ${name} run test
pnpm --filter ${name} run build      # 产出 lib/index.js${kind === 'k2' ? ' + lib/client.js（__ModuleLoader__ 闭包）' : ''}
\`\`\`

## 装进应用（@corum 公开层发布前）

\`\`\`bash
# 1) 打包（插件 + 它依赖的未发布 @corum 包）
pnpm --filter ${name} pack --pack-destination /tmp/plugin-packs
# 2) 在 profile 里把未发布的 @corum 包指向本地 tarball（同目录建 pnpm-workspace.yaml 的 overrides）
# 3) pnpm add /tmp/plugin-packs/<tarball> （cwd = ~/.corum/profiles/web）
# 4) 把包名加进 profile 的 dsh.profile.bundles，重启应用
\`\`\`

细节与踩坑：\`docs/PLUGIN-GUIDE.md\`；规则：\`docs/PLUGIN-SPEC.md\`。
`)

console.log(`✓ 已生成 ${kind === 'k2' ? '双半' : '仅宿主半'}插件骨架（${STANDALONE ? '独立工程' : '本仓 workspace'}）：${dir}`)
for (const file of files) console.log(`   + ${file}`)
console.log(`
下一步：
  pnpm install
  pnpm --filter ${name} run typecheck && pnpm --filter ${name} run test && pnpm --filter ${name} run build
`)
