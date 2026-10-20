# region-replacement —— 区域替换测试插件

用**官方 slot 的 priority 遮蔽**接管 IDE 右侧「编辑器」（`corum.editor`）与「终端」（`corum.panel`）
两个区域。它是插件 framework 的验收样例：只依赖 `@corum/plugin-sdk`（运行时）与
`@corum/plugin-build`（构建），**不 import 任何 corum 内部层包、不改宿主一个字节**。

```
examples/region-replacement-plugin/
  package.json          # exports 词典 + dsh.client + dsh.bundle.patch + corum.plugin
  tsdown.config.ts      # 三行：definePluginBundle({ id, client: {} })
  cordis.patch.yml      # insert 一行（客户端半按 loader 条目供应，必须有条目）
  src/index.ts          # 宿主半：no-op + 一个只读信息服务
  src/client/index.ts   # 关键：slots.inject + priority -1 接管两个区域
  src/client/EditorReplacement.tsx
  src/client/TerminalReplacement.tsx
```

## 它验证的三件事

| 能力 | 判据 |
|---|---|
| **区域替换**（不改宿主） | 装上后 `corum.editor` / `corum.panel` 里渲染的是本插件；卸载后宿主原 occupant 自动回来 |
| **主题与跨 bundle 读取** | 面板颜色全走 `--corum-glass-*` / `--dsw-alias-*` token；平台取自 `window.corumDesktop.getPlatform()` |
| **客户端半能真调 host RPC** | 编辑器面板里的「已装功能插件数」来自 `makeCorumRpcCall` → `pluginManager/list` |

## 机制（为什么这算「能替换」而不是「能并列」）

官方 slot 注册表对 `single` 槽的规则：

- **同一 priority 二次注册 ⇒ 直接 throw**（`already has a registration …`）
- **不同 priority ⇒ 允许共存，priority 最低的渲染**

宿主在 `priority: 0` 注册它的 occupant；本插件在 `priority: -1` 注册自己的 —— 于是接管，
且**卸载时注册随 fiber 一起撤销，宿主自动恢复**。这不需要任何内部层权限。

两个必须做对的前置：

1. **必须 `slots.inject(key, factory)`，不能直接 `register`**：区域槽由壳（父条目 children 表）
   声明，客户端半可能比声明先跑；`inject` 会等声明出现再注册。
2. **`dsh.client.inject` 里写 `slots`**（服务名），否则拿不到注册面。

## 可见性：区域默认是隐藏的

IDE 壳把 `corum.editor` / `corum.trajectory` / `corum.panel` 放进 `DEFAULT_HIDDEN`，
**隐藏时区域元素根本不进 DOM**（所以插件注册了 occupant 也看不见）。本插件的处理：

```ts
layout?.showRegion?.(key)          // 点亮（布局控制器的单槽包装）
layout?.setRegionHidden?.(key, false)
```

⚠️ 实测坑：**在主挂载那一刻调一次无效**（`showRegion` 的实现闭包依赖 AppFrame 的运行时
显隐状态，此时可能还没初始化）。本插件改成「400ms 间隔、最多 5 次、以区域元素是否进 DOM
为停止判据」的有界重试，实测可自动点亮。用户也可以随时用左侧活动栏的
「显示/隐藏 编辑器+资源管理器 / 终端」手动切换。

## 安装 / 卸载（未发布时的本地验证）

`@corum` 公开层还没发到 npm，所以先用 tarball + profile overrides：

```bash
# 1. 打包（插件 + 它的 SDK 依赖）
for p in packages/sdk/corum-plugin-sdk packages/plugins/ui/corum-ui-base \
         packages/plugins/ui/corum-rpc-client examples/region-replacement-plugin; do
  (cd $p && pnpm pack --pack-destination /tmp/rr-plugin); done

# 2. 在 profile 里把未发布的 @corum 包重定向到本地 tgz
cd ~/.corum/profiles/web   # 或你的 CORUM_HOME
cat >> pnpm-workspace.yaml <<'YAML'
overrides:
  '@corum/plugin-sdk': 'file:/tmp/rr-plugin/corum-plugin-sdk-0.6.0.tgz'
  '@corum/corum-ui-base': 'file:/tmp/rr-plugin/corum-corum-ui-base-0.6.0.tgz'
  '@corum/corum-rpc-client': 'file:/tmp/rr-plugin/corum-corum-rpc-client-0.6.0.tgz'
YAML

# 3. 装 + 加进 bundles
pnpm add /tmp/rr-plugin/corum-examples-region-replacement-0.6.0.tgz
node -e 'const fs=require("fs");const p="package.json";const j=JSON.parse(fs.readFileSync(p));
j.dsh.profile.bundles.push("@corum-examples/region-replacement");fs.writeFileSync(p,JSON.stringify(j,null,2))'

# 4. 重启应用
```

> **改了插件要重新 pack + 重装**：`pnpm add` 对同版本 `file:` spec 会认 lockfile 的 integrity，
> 直接 `pnpm add` 会说 "Already up to date"。先 `pnpm remove <name>` 再 `pnpm add`。
> 另外 `files` 字段**必须包含 `cordis.patch.yml`**，否则打包产物缺挂载层，启动预检会以
> `bad-patch` 跳过它（本插件第一版就是这么被挡下来的 —— 预检的报错信息很准确）。

卸载：`pnpm remove @corum-examples/region-replacement` + 从 `dsh.profile.bundles` 删掉 + 重启。

## 实测记录（2026-10-21，verify 实例 :9334）

- 装上后：`corum.editor` / `corum.panel` 区域元素出现，`[data-replacement="editor|terminal"]` 均存在
- 截图：`/tmp/corum-cdp/shots/rr-plugin-installed.png`
- 交互：向「终端」输入框打字回车 → 回显 `$ echo 插件替换成功`（输入事件穿过壳到达插件）
- 冲烟：4 通过 / 0 失败 / 零 console 错误
- 卸载 + 重启 + 点亮编辑器：宿主原 occupant 回来（`选择或打开一个文件开始编辑 资源管理器…`），
  `[data-replacement]` 消失 ⇒ **宿主文件真的没被改**


---

## 追加能力（2026-10-21 下半场）

### ① 读当前会话资源（token / 轮次 / 子 Agent）

宿主侧 `@corum/corum-platform` 新增服务 **`corumSessionFacts`**（与 `platform` 同包不同轴）：

- RPC `/api/corumSessionFacts/snapshot` → `{ tokens, context, stats, subagents, warnings }`
- RPC `/api/corumSessionFacts/toolNames` → 当前模型可见的工具名清单
- 客户端 helper：`@corum/plugin-sdk` 的 `readSessionFacts(connection)`

数据全部来自官方投影（`tokenUsage` / `contextPressure` / `sessionStats`）与 corum 子 Agent
血缘目录；**一次一致切**（同 `asOfSeq`）、**永不抛**（读不到进 `warnings`）。

### ② 给 Agent 注入工具

```ts
export const inject = ['tools']
export function apply(ctx) {
  ctx.effect(() => registerAgentTool(ctx.tools, defineAgentTool({ name: 'demo_session_report', … })))
}
```

本插件注入的 `demo_session_report`：Agent 自查「当前会话花了多少 token、跑了几轮、
派了几个子 Agent」。注册随 fiber 撤销 ⇒ 卸载插件工具即消失。

### 实机验证（verify :9334）

| 项 | 结果 |
|---|---|
| `corumSessionFacts/snapshot` | 返回契约形状；本实例无会话 ⇒ `warnings: ["没有可用会话"]`（fail-soft 生效） |
| `corumSessionFacts/toolNames` | `共 1 条：demo_session_report` ⇒ **插件注入的工具确实进了模型可见的工具面** |
| 设置 › 扩展 › 本插件 | 两个新卡片：会话资源（含刷新）+ Agent 工具面（含「✓ 在清单里」）；截图 `/tmp/corum-cdp/shots/rr-session-facts-tools.png` |
| 冲烟 | 4 通过 / 0 失败 / 零 console 错误 |

**未验证**：真实会话的 token/轮次数值 —— verify home 是干净 home，里面没有会话（也就不可能
有轮次）。要验数值需在有历史会话的 home 上跑，或真跑一轮 Agent（需要模型）。
