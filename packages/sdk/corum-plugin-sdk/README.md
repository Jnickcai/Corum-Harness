# @corum/plugin-sdk

corum 插件的**运行时唯一入口**：写一个插件只依赖它 + 官方基座（`@deepseek-ai/*`），
构建只用 `@corum/plugin-build`。零运行时逻辑 —— 只做类型聚合、两个恒等 helper、
以及官方能力的薄封装。

## 30 秒上手

```bash
npx corum-plugin-init --name @you/my-plugin --dir my-plugin   # 生成可构建的骨架
cd my-plugin && pnpm install && pnpm build
```

完整指南：**`GUIDE.md`**（随包发布，也可在线看仓库 `docs/PLUGIN-GUIDE.md`）。

## 导出面

**宿主半**（`@corum/plugin-sdk`）

```ts
import { definePlugin, defineAgentTool, registerAgentTool, readSessionFacts } from '@corum/plugin-sdk'
import type { Context, ToolDefinition, SessionFactsSnapshot } from '@corum/plugin-sdk'
```

**客户端半**（`@corum/plugin-sdk/client`）

```ts
import {
  defineClientPlugin, readSessionFacts,
  registerSlot, getSlotMeta, GridView, RegionCard, MosaicWall, ThemePresenter, joinPath,
  makeCorumRpcCall,
} from '@corum/plugin-sdk/client'
```

UI 面的**可碰范围**由 `@corum/plugin-ui-contract` 定义（右侧区域覆盖 + 设置 ›「扩展」页）。

## 依赖位置（写错就是"运行期静默炸"）

| 位置 | 放什么 |
|---|---|
| `dependencies` | `@corum/plugin-sdk`（**不能**放 peer：宿主只把安装闭包链进 profile） |
| `peerDependencies` | `@deepseek-ai/*` 官方基座、`react`（由宿主提供） |
| `devDependencies` | `@corum/plugin-build`、`tsdown`、`typescript`、官方基座的 dev 镜像 |

## CLI

```bash
npx corum-plugin-init --name @you/my-plugin --dir my-plugin          # 双半插件（有 UI）
npx corum-plugin-init --name @you/my-api   --dir my-api --kind k1    # 只有宿主半
```

生成的骨架已满足 exports 词典、`dsh.client`↔`./client` 配对、三步构建、`files` 带
`cordis.patch.yml`、`corum.plugin` 兼容声明 —— 改业务即可。
