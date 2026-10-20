#!/usr/bin/env node
/**
 * create-plugin.mjs —— 本仓内生成插件的**薄包装**（真正的实现在 SDK 包里，跟包一起发布）。
 *
 * 为什么不留第二份实现：骨架是「第三方怎么开始」的唯一事实源，两份模板必然漂移。
 * 实现位置：`packages/sdk/corum-plugin-sdk/bin/corum-plugin-init.mjs`（随 `@corum/plugin-sdk`
 * 发布，第三方用 `npx corum-plugin-init`）。本脚本只做一件事：把它以 **repo 模式**跑一次
 * （依赖用 `workspace:*`、tsconfig extends 仓库基座）。
 *
 *   node scripts/create-plugin.mjs --name @you/my-plugin --dir examples/my-plugin [--kind k2]
 *
 * @module scripts/create-plugin
 */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const bin = resolve(ROOT, 'packages/sdk/corum-plugin-sdk/bin/corum-plugin-init.mjs')

// 透传参数，并强制 repo 模式（依赖 workspace:* / tsconfig extends 仓库基座）。
const passthrough = process.argv.slice(2).filter(a => a !== '--repo' && a !== '--standalone')
execFileSync(process.execPath, [bin, ...passthrough, '--repo'], { stdio: 'inherit', cwd: ROOT })
