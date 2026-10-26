# 阶段 -1：官方升级指南映射

> 状态：待开工 | 前置：无（一切的前置） | 预估工程量：约 0.5-1 人日
> （43 篇英文正文实测约 952 行 / 75KB，阅读约 0.5h；主要工作量是逐篇 grep/映射分析）

## 1. 目标与范围

**目标**：通读 dsh 官方 `dsh-v0.2.1-rc.3` tag 下 `docs/upgrade-guide/` 的全部升级指南
（7 个版本目录，共 **43 篇**），逐篇评估对 corum fork 仓的影响，产出「指南 → corum 影响映射表」。
该映射表是后续阶段 1-6 执行的输入——避免靠考古 commit 摸索迁移面，直接用官方现成迁移文档。

**数量说明**：官方共 43 篇 guide（7 目录分布 2/6/22/10/1/1/1）。全树 129 文件 = 每篇 guide.md +
guide.zh.md + guide.i18n.yaml。本阶段只读英文 `guide.md`（43 个），不读 zh.md / yaml。

**范围**：
- 只读 `/Users/kukucai/dsh` 仓（严禁 checkout / 写）。
- 只产出映射表文档，不改任何源码。
- 映射表每条影响必须归入阶段 1-6 之一或显式标注「corum 不受影响」。

**不做的事**：
- 不执行任何代码修改（那是阶段 1+ 的事）。
- 不做 commit 探源（可行性文档 + 评审报告已完成此项）。
- 不验证 npm 包可解析性（那是阶段 2 的事）。

## 2. 前置条件（准入门禁）

| # | 条件 | 验证方式 | 状态 |
|---|---|---|---|
| 1 | 可行性文档已通读 | `docs/UPGRADE-0.2.1-rc3-feasibility.md` 在 HEAD | ☐ |
| 2 | 六份评审报告已可访问 | 原三份 `~/.corum/research-reports/{885858d9,5c35a73b,06867ebb}-*.md` 可读（后续阶段基础证据）；新增三份 `{e9de057a,abf2af7e,958879cc}-*.md` 可读（阶段 -1 专用） | ☐ |
| 3 | dsh 仓 tag `dsh-v0.2.1-rc.3` 存在 | `git -C /Users/kukucai/dsh tag -l 'dsh-v0.2.1-rc.3'` | ☐ |

> 无代码前置——本阶段纯文档工作。

## 3. 输入与依赖

| 输入 | 来源 | 用途 |
|---|---|---|
| 官方升级指南 | `dsh-v0.2.1-rc.3:docs/upgrade-guide/` | 逐篇通读（只读 guide.md） |
| 可行性文档 §六阶段 -1 | `docs/UPGRADE-0.2.1-rc3-feasibility.md` | 已列必读清单 |
| 评审报告 06867ebb §E2-c | `~/.corum/research-reports/06867ebb-*.md` | 确认 7 目录 43 篇 |
| corum fork 包清单 | `packages/plugins/{agent,session,ui}/` 下 50 个包 | 评估影响面 |
| corum 组合文件 | `packages/desktop/cordis.patch.yml` + `profile/corum/cordis.patch.yml` | 判断是否受影响 |
| corum override 表 | `pnpm-workspace.yaml:43-306`（217 条） | 判断包依赖面 |

## 4. 执行步骤（命令级，逐步可执行，每步带验证命令）

### 步骤 1：列出官方升级指南全清单

```bash
# 列出 dsh-v0.2.1-rc.3 tag 下 docs/upgrade-guide/ 的全部文件
git -C /Users/kukucai/dsh ls-tree -r --name-only dsh-v0.2.1-rc.3 docs/upgrade-guide/
```

**验证**：输出应包含 7 个版本目录，每个目录下有若干 `guide.md`。预期分布：

| 版本目录 | 篇数 | 说明 |
|---|---|---|
| `v0.1.7-rc.2/` | 2 | 0.1.5→0.1.7 过渡 |
| `v0.2.0-rc.2/` | 6 | 含 `remove-runtime-invariants`（已引用于可行性文档 §三·1） |
| `v0.2.1-alpha.1/` | 22 | 最多，含 subagent/session-title 等 corum 直接相关篇 |
| `v0.2.1-alpha.2/` | 10 | |
| `v0.2.1-alpha.3/` | 1 | |
| `v0.2.1-alpha.4/` | 1 | |
| `v0.2.1-rc.2/` | 1 | |

> 来源：评审报告 06867ebb §E2-c（`git ls-tree` 实测）。全树 129 文件 = 43 篇 × 3（guide.md + guide.zh.md + guide.i18n.yaml）。

### 步骤 2：逐篇读取指南内容

对步骤 1 输出的每个 `guide.md`，用 `git show` 读取（**只读英文 guide.md，不读 guide.zh.md / guide.i18n.yaml**）：

```bash
# 示例：读 subagent-activations 指南
git -C /Users/kukucai/dsh show dsh-v0.2.1-rc.3:docs/upgrade-guide/v0.2.1-alpha.1/subagent-activations/guide.md

# 批量读全部 guide.md（只读英文，输出到临时文件便于逐篇分析）
git -C /Users/kukucai/dsh ls-tree -r --name-only dsh-v0.2.1-rc.3 docs/upgrade-guide/ \
  | grep '/guide\.md$' \
  | while IFS= read -r f; do
      echo "===== $f ====="
      git -C /Users/kukucai/dsh show "dsh-v0.2.1-rc.3:$f"
    done > /tmp/upgrade-guides-all.txt
```

**验证**：
```bash
# 确认只读了英文 guide.md（应为 43 篇，不是 129 文件）
grep -c '/guide\.md$' <(git -C /Users/kukucai/dsh ls-tree -r --name-only dsh-v0.2.1-rc.3 docs/upgrade-guide/)

# 确认总行数（43 篇英文正文实测约 952 行 / 75KB，加分隔符后约 1000 行）
wc -l /tmp/upgrade-guides-all.txt
# 应约 1000 行，而非数千行（只读了 guide.md，不含 zh.md / yaml）
```

> **注意**：`/tmp/upgrade-guides-all.txt` 重启即清，**不可作为跨阶段唯一依据**——跨阶段回查请用 `git -C /Users/kukucai/dsh show dsh-v0.2.1-rc.3:<path>` 直接读取。

### 步骤 3：逐篇分析对 corum 的影响

对每篇指南，回答以下 **6** 个问题，填入映射表（见步骤 4 模板）：

1. **涉及哪些官方包**？指南标题/正文中提到的 `@deepseek-ai/dsh-*` 包名。
2. **corum 是否有引用点**？在 corum 仓 grep 对应包名，确认是否有 fork 包依赖、import、组合挂载。
3. **影响的 fork 包**？corum 的 50 个 fork 包中哪些与此指南相关。
4. **所需动作**？改 dep / 改 import / 改组合 / 改测试 / 无需改动。
5. **归入哪个阶段**？阶段 1（被删包）/ 2（override）/ 3（fork rebase）/ 4（验证）/ 5（进程隔离）/ 6（sidecar）/ 标注「corum 不受影响」。
6. **是否只改服务名/事件名/RPC 面/配置 schema 而不改包名**？若是，则必须 grep corum 的 `inject('...')` / `ctx.get('...')` 调用点、两份 `cordis.patch.yml`、`scripts/verify-fork-drift.sh` 的事件 allowlist——**不得只 grep 包名**（包名没变不代表无影响：服务名/RPC 面变了会断 inject）。

**已知必读清单**（可行性文档 §六 + 评审报告 06867ebb §E2-c 确认与 corum 直接相关，共 **13 篇**）：

| 指南篇名 | 所在版本目录 | 为何必读 |
|---|---|---|
| `subagent-activations` | `v0.2.1-alpha.1/` | 直击 corum-subagent 的 activation 生命周期（官方 `3d852a1cea` 合并驱动） |
| `subagent-preset-composition` | `v0.2.1-alpha.1/` | 直击 corum-subagent rebase（preset 声明迁移） |
| `jsonl-persistence-plugin` | `v0.2.1-alpha.1/` | SessionWriteLease / persistence 形态变化 |
| `working-directory` | `v0.2.1-alpha.1/` | 会话工作目录语义（`session/working-directory` 新包）；corum 有 `{{cwd}}` 提示变量残留 |
| `session-title-provider-strategy` | `v0.2.1-alpha.1/` | session-title-llm provider API 迁移（可行性文档 §三 dsh-session-title 行） |
| `session-title-adapters` | `v0.2.1-alpha.1/` | session-title adapter 变化（与上一篇配对） |
| `plugin-engines-dsh` | `v0.2.1-alpha.3/` | 兼容性检查优先读 engines.dsh；拒绝记录 peers 改名 requirements（与 HMR 无关） |
| `from-default-profile-replaces-target` | `v0.2.1-alpha.2/` | profile 组合语义变化（corum 不受影响 + 备忘） |
| `new-session-blank-reuse` | `v0.2.1-rc.2/` | 新建会话语义（阶段 4 行为观察） |
| `remove-runtime-invariants` | `v0.2.0-rc.2/` | invariants 删除（可行性文档 §三·1 方案 A 已定） |
| `experimental-package-composition` | `v0.2.1-alpha.1/` | 实验性包组合（新组合语义关联红线 5） |
| `web-listener-trust-config` | `v0.2.1-alpha.1/` | webRuntime→webStartup、trustedHosts 配置迁移；命中 corum `packages/desktop/cordis.patch.yml:36-41` trustedHosts:[] 和 `src/host/boot.ts:524-528` 四行链 |
| `plugin-install-over-installed` | `v0.2.1-alpha.2/` | HMR 下 installBundle 对已安装包报 already-installed，需先 removeBundle；命中 corum-extension-pack install-local/uninstall、corum-ide-plugin-manager-ui、corum-rpc-client |

> 其余 **30** 篇也须逐篇过一遍，但上述 13 篇是高优先级。

### 步骤 4：产出「指南 → corum 影响映射表」

将步骤 3 的分析结果填入以下映射表模板（追加到本册附录 A，见 §8 产出物）：

```markdown
## 附录 A：指南 → corum 影响映射表

| # | 指南篇名 | 版本目录 | 涉及官方包 | corum 引用点 | 影响的 fork 包 | 所需动作 | 归入阶段 | 横切标签 |
|---|---|---|---|---|---|---|---|---|
| 1 | subagent-activations | v0.2.1-alpha.1 | dsh-subagent | corum-subagent activation 生命周期 | corum-subagent | ... | 1+3+4 | ... |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |
| N | <篇名> | <目录> | <包名> | <引用点或无> | <fork 包名或无> | <动作或"corum 不受影响"> | <阶段或N/A> | <build/ci/docs/空> |
```

> 映射表可加可选「横切标签」列（build/ci/docs），用于标注跨阶段横切关注点，**不扩阶段号**。

### 步骤 5：交叉校验映射表完整性

```bash
# 确认指南篇目总数（只数 guide.md）
git -C /Users/kukucai/dsh ls-tree -r --name-only dsh-v0.2.1-rc.3 docs/upgrade-guide/ \
  | grep -c '/guide\.md$'
# 输出应为 43
```

**验证**：
- 映射表有效条目数 ≥ 43（每篇至少一行）。
- 每行的「归入阶段」列要么是 1/2/3/4/5/6 之一（可组合），要么标注「corum 不受影响」。
- 高优先级 13 篇全部有详细分析（非空行）。

## 5. 验收标准（退出门禁，可判定）

| # | 标准 | 判定方式 | 状态 |
|---|---|---|---|
| 1 | 映射表覆盖全部指南篇目 | 有效映射条目 ≥ 43（步骤 5 的 `grep -c '/guide\.md$'` 输出） | ☐ |
| 2 | 每条影响都落到阶段 1-6 之一或标注「corum 不受影响」 | 逐行检查「归入阶段」列 | ☐ |
| 3 | 13 篇高优先级指南有详细分析 | 每篇至少记录涉及包 + 引用点 + 动作 + 阶段 | ☐ |
| 4 | 映射表已追加到本册附录 | 本文件附录 A 存在且非空 | ☐ |
| 5 | 未改任何源码 | `git diff --stat HEAD` 只含 01 册（本阶段执行时）；`git status --porcelain` 非 `docs/` 路径为空 | ☐ |

> **门禁 5 机械判定**：`git status --porcelain` 中非 `docs/` 路径必须为空，且 `git diff --stat HEAD` 只含 01 册文件（本阶段执行时）。本阶段执行只允许修改 01 自身。**不得要求不存在的实录文件**——实录暂记本册附录 B（见 §9），阶段 0 建骨架时转录。

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 指南正文未明确包名，需交叉考古 commit | 中 | 以可行性文档 §三 + 评审报告 885858d9 为权威引用点清单，指南只补充迁移手法 |
| corum 引用点遗漏（grep 漏报） | 中 | 评审报告 885858d9 已逐文件逐行核对 50 个 fork 包的 package.json + tsdown.config.ts + src/，以报告为准 |
| 指南描述的 API 变化与 corum 实际用法不匹配 | 低 | 逐篇读指南时同步 grep corum 仓确认实际用法 |
| 某篇指南涉及 corum 未装配的包 | 低 | 标注「corum 不受影响」即可，不影响后续阶段 |
| 只 grep 包名漏掉服务名/RPC 面/事件名变更 | 中 | 步骤 3 第 6 问强制 grep `inject('...')`/`ctx.get('...')`/两份 patch/事件 allowlist |

## 7. 回滚方案

**本阶段无回滚需求**——纯文档工作，不改源码。若映射表质量不达标，重做步骤 3-4 即可。

## 8. 产出物与下游接口

| 产出物 | 位置 | 下游消费者 |
|---|---|---|
| 指南 → corum 影响映射表 | 本册附录 A（执行时填入） | 阶段 1-6 各册的「输入与依赖」 |
| 全部指南文本（临时） | `/tmp/upgrade-guides-all.txt`（不入库，重启即清） | 阶段 1-3 执行时按需回查（跨阶段回查用 `git show` 直接读取） |
| 实录暂记 | 本册附录 B（执行时填入） | 阶段 0 步骤 6 建实录骨架时转录 |

**下游接口契约**：
- 映射表中每条「归入阶段 = X」的记录，对应阶段 X 手册的「输入与依赖」§3 应引用该指南篇名。
- 阶段 1 手册（`03-removed-packages.md`）应从映射表筛选所有「归入阶段 = 1」的条目作为输入。
- 阶段 3 手册（`05-fork-rebase.md`）应从映射表筛选所有「归入阶段 = 3」的条目作为输入。

## 9. 实录要求（执行时暂记本册附录 B，阶段 0 转录）

执行本阶段时，暂记内容写入**本册附录 B**（见下方模板）。**阶段 0 步骤 6 建 `docs/UPGRADE-0.2.1-rc3.md` 骨架时，将附录 B 内容转录到实录文件**。

> **约束**：本阶段执行只允许修改 01 自身——不创建 `docs/UPGRADE-0.2.1-rc3.md`（那是阶段 0 的事）。

暂记内容：

1. **步骤 1 的命令输出**：`git ls-tree` 的完整文件列表（43 篇 guide.md 的路径）。
2. **步骤 2 的批量读命令**与总行数（预期约 1000 行）。
3. **步骤 3 的逐篇分析摘要**：每篇一句话结论（涉及什么 / corum 是否受影响 / 归入哪个阶段）。
4. **步骤 5 的交叉校验结果**：`grep -c '/guide\.md$'` 输出 43，映射表条目数。
5. **偏差记录**：若发现可行性文档或评审报告有遗漏的指南篇目或影响，在此记录。
6. **时间**：本阶段实际耗时。

---

## 附录 A：指南 → corum 影响映射表

> **执行时填入**。以下为预填模板（高优先级 13 篇已预填，其余 30 篇执行时逐篇补全）。
> **执行阶段 -1 时须逐篇补满 43 条有效记录，不得留占位行**（门禁计数要求有效映射条目 ≥ 43）。

| # | 指南篇名 | 版本目录 | 涉及官方包 | corum 引用点 | 影响的 fork 包 | 所需动作 | 归入阶段 | 横切标签 |
|---|---|---|---|---|---|---|---|---|
| 1 | subagent-activations | v0.2.1-alpha.1 | dsh-subagent | corum-subagent activation 生命周期 | corum-subagent | 删 backgroundMode/enableRunInBackground 配置（`corum-tool-subagent/src/index.ts:153-163`）；start/startContinuable→startActivation（`:2757`/`:4101` 及 `isolation-confinement.spec:121`）；run_in_background 工具参数删除及结果消费改 subagentId+completion notice；SubagentRun.id 全局唯一；local delegation 需 persistence+session/wait | 1+3+4 | — |
| 2 | subagent-preset-composition | v0.2.1-alpha.1 | dsh-agent-presets → preset/agent-preset | `corum-agent/src/agent-service.ts:49`、`corum-agent/src/preset-reload.ts:37` type import、`corum-subagent/src/child-agent.ts:28` type import、corum-api-remotes dep | corum-agent, corum-subagent, corum-api-remotes | 阶段 1 改 dep+import + 阶段 3 rebase | 1+3 | — |
| 3 | jsonl-persistence-plugin | v0.2.1-alpha.1 | session-persistence-jsonl | SessionWriteLease 形态（0.1.5 已含，0.2.1 预编译 Node-API flock） | corum-subagent（间接依赖） | 阶段 3 rebase 时关注 + 阶段 4.5 addon 验证 | 3+4 | — |
| 4 | working-directory | v0.2.1-alpha.1 | session/working-directory, tool-working-directory | corum `packages/desktop/cordis.patch.yml:234` 有 `Your working directory is {{cwd}}` 提示变量残留；corum-subagent fork 动机之一是 cwd 透传；corum-tools presentationMeta 嵌套 PTC | corum-subagent, corum-tools | 官方删 `{{cwd}}` 提示变量和 acp/dsh-sdk subagent config.cwd，start request cwd 被官方支持；corum 残留 `{{cwd}}` 会在模型请求前失败；阶段 3 需裁决官方收编后保留/删除 corum 增量；presentationMeta 嵌套 PTC 归阶段 4 验证 | 1+3+4 | — |
| 5 | session-title-provider-strategy | v0.2.1-alpha.1 | dsh-session-title-llm | `desktop-host/package.json:105` dep（-llm）、`corum-agent/src/agent-service.ts:67` type import、`corum-agent/package.json:55` dep + `:99` devDep、UI 元数据（`corum-ide-ui:47-48`、`corum-ide-plugin-manager-ui:42-43`） | corum-agent | 阶段 1 迁移 provider API | 1 | — |
| 6 | session-title-adapters | v0.2.1-alpha.1 | dsh-session-title | 同上 | 同上 | 阶段 1 配对迁移 | 1 | — |
| 7 | plugin-engines-dsh | v0.2.1-alpha.3 | engines.dsh / peerDependencies→requirements | corum 46 个 fork 包有 peerDependencies、0 个有 engines.dsh | corum-ide-plugin-manager-ui（执行时核查是否读 peers 字段） | 兼容性检查优先读 engines.dsh；拒绝记录 peers 改名 requirements。包声明预期无需改（corum 0 个 engines.dsh）；执行时核查 corum-ide-plugin-manager-ui 是否读 peers 字段。**与 HMR 无关——不得当 HMR 依据** | corum 不受影响（待核查 plugin-manager-ui peers 读取） | — |
| 8 | from-default-profile-replaces-target | v0.2.1-alpha.2 | dsh-base / profile 组合 | profile/corum/ 组合文件 | — | corum 不受影响 + 备忘（CLI 重建会删目标目录；corum 不走该 CLI，profile patch 手维护） | corum 不受影响 | — |
| 9 | new-session-blank-reuse | v0.2.1-rc.2 | session 控制器 | corum 新任务走 `corum-ide-sidebar-ui/src/client/index.ts:180-198` 自有 RPC，不直接走 uiWorkspace.startSession | — | 阶段 4 行为观察 | 4 | — |
| 10 | remove-runtime-invariants | v0.2.0-rc.2 | dsh-invariants | 4 fork 包 invariant.ts + dep + external + `desktop-host/package.json:86` + `pnpm-workspace.yaml:155` | corum-goal-round-driver, corum-tool-subagent, corum-subagent, corum-tools | 方案 A 跟随删除（可行性文档 §三·1） | 1 | — |
| 11 | experimental-package-composition | v0.2.1-alpha.1 | 实验性包组合 | corum disabled 官方行 + insert fork 行四组（`packages/desktop/cordis.patch.yml:199/207/224/236`） | — | 阶段 3；新组合语义「只 enable 被删行的 patch 不插入插件」，四组 disabled+insert 需重验（关联红线 5：不得 filter disabled 行） | 3 | — |
| 12 | web-listener-trust-config | v0.2.1-alpha.1 | webRuntime→webStartup、trustedHosts | `packages/desktop/cordis.patch.yml:36-41` trustedHosts:[] + `src/host/boot.ts:524-528` 四行链 | — | webRuntime→webStartup 配置迁移、trustedHosts 配置迁移 | 1+3 | — |
| 13 | plugin-install-over-installed | v0.2.1-alpha.2 | installBundle/removeBundle | corum-extension-pack install-local/uninstall、corum-ide-plugin-manager-ui、corum-rpc-client | corum-extension-pack, corum-ide-plugin-manager-ui, corum-rpc-client | HMR 下 installBundle 对已安装包报 already-installed，需先 removeBundle | 3+4 | — |

> **填表纪律**：
> - 「corum 引用点」列必须给出具体文件:行号（从评审报告 885858d9 取或 grep 确认），不能只写「有」。
> - 「归入阶段」列不能留空——要么写阶段号，要么写「corum 不受影响」。
> - 待确认项在执行时补全，不留空行。

---

## 附录 B：阶段 -1 实录暂记模板

> **执行时填入**。阶段 0 步骤 6 建 `docs/UPGRADE-0.2.1-rc3.md` 骨架时，将本附录内容转录到实录文件。

```
## 阶段 -1：官方升级指南映射（实录）

### 步骤 1 输出
- 命令：git -C /Users/kukucai/dsh ls-tree -r --name-only dsh-v0.2.1-rc.3 docs/upgrade-guide/
- guide.md 总数：<填，预期 43>
- 全树文件总数：<填，预期 129 = 43×3>

### 步骤 2 输出
- 批量读命令：<填>
- /tmp/upgrade-guides-all.txt 总行数：<填，预期约 1000>

### 步骤 3 逐篇分析摘要
<每篇一句话结论>

### 步骤 5 交叉校验
- grep -c '/guide\.md$' 输出：<填，预期 43>
- 映射表有效条目数：<填，≥43>

### 偏差记录
<若有>

### 时间
<填>
```

---

## 开放问题：0.2.1 HMR 形态待实证

> **状态**：0.2.1 HMR 形态待实证，**不许断言「dsh-hmr 是 cordis-plugin-hmr 的替代改名」**。

评审核实结论：
- `dsh-hmr` 在官方 `apps/cli/README` 中是 **profile-manifest / patch watcher**，与 cordis-plugin-hmr 的职责描述不同。
- corum 三份 `cordis.patch.yml` **没有 hmr 行**（grep 零命中）——hmr 行来自官方 `base/cordis.patch.yml`。
- corum 实际引用点（已知触点）：
  - `packages/desktop/desktop-host/package.json:53` dep `@deepseek-ai/cordis-plugin-hmr ^1.0.16`
  - `pnpm-workspace.yaml:292` override `@deepseek-ai/cordis-plugin-hmr 1.0.17`
  - `corum-ide-plugin-manager-ui` plugin-meta 中引用

**执行时核查命令**（阶段 -1 步骤 3 分析 `plugin-engines-dsh` 时同步核查）：

```bash
# 核对 dsh-hmr 职责与适用面
git -C /Users/kukucai/dsh show dsh-v0.2.1-rc.3:packages/bundle/base/cordis.patch.yml
git -C /Users/kukucai/dsh show dsh-v0.2.1-rc.3:packages/boot/hmr/package.json
git -C /Users/kukucai/dsh show dsh-v0.2.1-rc.3:apps/cli/README.md
```

**裁决原则**：核对职责与适用面后，再决定阶段 1/2 的 HMR 相关动作。在阶段 -1 裁决前，**禁止未核实就替换 dep/override**。03 册 §4.6 的执行动作也以此为前置。
