# 阶段 -1：官方升级指南映射

> 状态：待开工 | 前置：无（一切的前置） | 预估工程量：约 0.5-1 人日（读 40 篇指南 + 建映射表）

## 1. 目标与范围

**目标**：通读 dsh 官方 `dsh-v0.2.1-rc.3` tag 下 `docs/upgrade-guide/` 的全部升级指南
（7 个版本目录，约 40 篇），逐篇评估对 corum fork 仓的影响，产出「指南 → corum 影响映射表」。
该映射表是后续阶段 1-6 执行的输入——避免靠考古 commit 摸索迁移面，直接用官方现成迁移文档。

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
| 2 | 三份评审报告已可访问 | `~/.corum/research-reports/{885858d9,5c35a73b,06867ebb}-*.md` 可读 | ☐ |
| 3 | dsh 仓 tag `dsh-v0.2.1-rc.3` 存在 | `git -C /Users/kukucai/dsh tag -l 'dsh-v0.2.1-rc.3'` | ☐ |

> 无代码前置——本阶段纯文档工作。

## 3. 输入与依赖

| 输入 | 来源 | 用途 |
|---|---|---|
| 官方升级指南 | `dsh-v0.2.1-rc.3:docs/upgrade-guide/` | 逐篇通读 |
| 可行性文档 §六阶段 -1 | `docs/UPGRADE-0.2.1-rc3-feasibility.md` | 已列必读清单 |
| 评审报告 06867ebb §E2-c | `~/.corum/research-reports/06867ebb-*.md` | 确认 7 目录约 40 篇 |
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

> 来源：评审报告 06867ebb §E2-c（`git ls-tree` 实测）。

### 步骤 2：逐篇读取指南内容

对步骤 1 输出的每个 `guide.md`，用 `git show` 读取：

```bash
# 示例：读 subagent-activations 指南
git -C /Users/kukucai/dsh show dsh-v0.2.1-rc.3:docs/upgrade-guide/v0.2.1-alpha.1/subagent-activations/guide.md

# 批量读全部（输出到临时文件便于逐篇分析）
git -C /Users/kukucai/dsh ls-tree -r --name-only dsh-v0.2.1-rc.3 docs/upgrade-guide/ \
  | while read f; do
      echo "===== $f ====="
      git -C /Users/kukucai/dsh show "dsh-v0.2.1-rc.3:$f"
    done > /tmp/upgrade-guides-all.txt
```

**验证**：`wc -l /tmp/upgrade-guides-all.txt` 应有可观行数（40 篇指南，预计数千行）。

### 步骤 3：逐篇分析对 corum 的影响

对每篇指南，回答以下 5 个问题，填入映射表（见步骤 4 模板）：

1. **涉及哪些官方包**？指南标题/正文中提到的 `@deepseek-ai/dsh-*` 包名。
2. **corum 是否有引用点**？在 corum 仓 grep 对应包名，确认是否有 fork 包依赖、import、组合挂载。
3. **影响的 fork 包**？corum 的 50 个 fork 包中哪些与此指南相关。
4. **所需动作**？改 dep / 改 import / 改组合 / 改测试 / 无需改动。
5. **归入哪个阶段**？阶段 1（被删包）/ 2（override）/ 3（fork rebase）/ 4（验证）/ 5（进程隔离）/ 6（sidecar）/ 标注「corum 不受影响」。

**已知必读清单**（可行性文档 §六 + 评审报告 06867ebb §E2-c 确认与 corum 直接相关）：

| 指南篇名 | 所在版本目录 | 为何必读 |
|---|---|---|
| `subagent-activations` | `v0.2.1-alpha.1/` | 直击 corum-subagent 的 activation 生命周期（官方 `3d852a1cea` 合并驱动） |
| `subagent-preset-composition` | `v0.2.1-alpha.1/` | 直击 corum-subagent rebase（preset 声明迁移） |
| `jsonl-persistence-plugin` | `v0.2.1-alpha.1/` | SessionWriteLease / persistence 形态变化 |
| `working-directory` | `v0.2.1-alpha.1/` | 会话工作目录语义（`session/working-directory` 新包） |
| `session-title-provider-strategy` | `v0.2.1-alpha.1/` | session-title-llm provider API 迁移（可行性文档 §三 dsh-session-title 行） |
| `session-title-adapters` | `v0.2.1-alpha.1/` | session-title adapter 变化（与上一篇配对） |
| `plugin-engines-dsh` | `v0.2.1-alpha.1/` | `dsh-hmr` 替代 `cordis-plugin-hmr`（压着 corum 插件框架） |
| `from-default-profile-replaces-target` | `v0.2.1-alpha.1/` | profile 组合语义变化 |
| `new-session-blank-reuse` | `v0.2.1-alpha.1/` | 新建会话语义 |
| `remove-runtime-invariants` | `v0.2.0-rc.2/` | invariants 删除（可行性文档 §三·1 方案 A 已定） |
| `experimental-package-composition` | `v0.2.1-alpha.1/` | 实验性包组合 |

> 其余约 29 篇也须逐篇过一遍，但上述 11 篇是高优先级。

### 步骤 4：产出「指南 → corum 影响映射表」

将步骤 3 的分析结果填入以下映射表模板（追加到本册附录，见 §8 产出物）：

```markdown
## 附录 A：指南 → corum 影响映射表

| # | 指南篇名 | 版本目录 | 涉及官方包 | corum 引用点 | 影响的 fork 包 | 所需动作 | 归入阶段 |
|---|---|---|---|---|---|---|---|
| 1 | subagent-activations | v0.2.1-alpha.1 | dsh-subagent | corum-subagent 的 activation 生命周期 | corum-subagent | 阶段 3 rebase 时对齐 activation 合并 | 3 |
| 2 | subagent-preset-composition | v0.2.1-alpha.1 | dsh-agent-presets→preset/agent-preset | corum-agent type import + corum-subagent child-agent | corum-agent, corum-subagent, corum-api-remotes | 阶段 1 改 dep + import + 阶段 3 rebase | 1+3 |
| 3 | remove-runtime-invariants | v0.2.0-rc.2 | dsh-invariants | 4 fork 包 invariant.ts + dep + external + desktop-host:86 | corum-goal-round-driver, corum-tool-subagent, corum-subagent, corum-tools | 方案 A 跟随删除（§三·1） | 1 |
| ... | ... | ... | ... | ... | ... | ... | ... |
| N | <篇名> | <目录> | <包名> | <引用点或无> | <fork 包名或无> | <动作或"corum 不受影响"> | <阶段或N/A> |
```

### 步骤 5：交叉校验映射表完整性

```bash
# 确认映射表条目数 = 指南总数
git -C /Users/kukucai/dsh ls-tree -r --name-only dsh-v0.2.1-rc.3 docs/upgrade-guide/ \
  | grep -c 'guide.md'
# 输出应为约 40（步骤 1 的总数）
```

**验证**：
- 映射表行数 ≥ 指南总数（每篇至少一行）。
- 每行的「归入阶段」列要么是 1/2/3/4/5/6 之一，要么标注「corum 不受影响」。
- 高优先级 11 篇全部有详细分析（非空行）。

## 5. 验收标准（退出门禁，可判定）

| # | 标准 | 判定方式 | 状态 |
|---|---|---|---|
| 1 | 映射表覆盖全部指南篇目 | 映射表行数 ≥ 步骤 1 列出的 guide.md 总数 | ☐ |
| 2 | 每条影响都落到阶段 1-6 之一或标注「corum 不受影响」 | 逐行检查「归入阶段」列 | ☐ |
| 3 | 11 篇高优先级指南有详细分析 | 每篇至少记录涉及包 + 引用点 + 动作 + 阶段 | ☐ |
| 4 | 映射表已追加到本册附录 | 本文件附录 A 存在且非空 | ☐ |
| 5 | 未改任何源码 | `git diff --stat` 无源码改动 | ☐ |

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 指南正文未明确包名，需交叉考古 commit | 中 | 以可行性文档 §三 + 评审报告 885858d9 为权威引用点清单，指南只补充迁移手法 |
| corum 引用点遗漏（grep 漏报） | 中 | 评审报告 885858d9 已逐文件逐行核对 50 个 fork 包的 package.json + tsdown.config.ts + src/，以报告为准 |
| 指南描述的 API 变化与 corum 实际用法不匹配 | 低 | 逐篇读指南时同步 grep corum 仓确认实际用法 |
| 某篇指南涉及 corum 未装配的包 | 低 | 标注「corum 不受影响」即可，不影响后续阶段 |

## 7. 回滚方案

**本阶段无回滚需求**——纯文档工作，不改源码。若映射表质量不达标，重做步骤 3-4 即可。

## 8. 产出物与下游接口

| 产出物 | 位置 | 下游消费者 |
|---|---|---|
| 指南 → corum 影响映射表 | 本册附录 A（执行时填入） | 阶段 1-6 各册的「输入与依赖」 |
| 全部指南文本（临时） | `/tmp/upgrade-guides-all.txt`（不入库） | 阶段 1-3 执行时按需回查 |

**下游接口契约**：
- 映射表中每条「归入阶段 = X」的记录，对应阶段 X 手册的「输入与依赖」§3 应引用该指南篇名。
- 阶段 1 手册（`03-removed-packages.md`）应从映射表筛选所有「归入阶段 = 1」的条目作为输入。
- 阶段 3 手册（`05-fork-rebase.md`）应从映射表筛选所有「归入阶段 = 3」的条目作为输入。

## 9. 实录要求（执行时往 `docs/UPGRADE-0.2.1-rc3.md` 记什么）

执行本阶段时，往实录文件 `docs/UPGRADE-0.2.1-rc3.md` 记录以下内容：

1. **步骤 1 的命令输出**：`git ls-tree` 的完整文件列表（40 篇的路径）。
2. **步骤 2 的批量读命令**与总行数。
3. **步骤 3 的逐篇分析摘要**：每篇一句话结论（涉及什么 / corum 是否受影响 / 归入哪个阶段）。
4. **步骤 5 的交叉校验结果**：映射表行数 vs 指南总数。
5. **偏差记录**：若发现可行性文档或评审报告有遗漏的指南篇目或影响，在此记录。
6. **时间**：本阶段实际耗时。

---

## 附录 A：指南 → corum 影响映射表

> **执行时填入**。以下为预填模板（高优先级 11 篇 + 空行供其余篇目补充）。
> 空行在执行阶段 -1 时逐篇补全。

| # | 指南篇名 | 版本目录 | 涉及官方包 | corum 引用点 | 影响的 fork 包 | 所需动作 | 归入阶段 |
|---|---|---|---|---|---|---|---|
| 1 | subagent-activations | v0.2.1-alpha.1 | dsh-subagent | corum-subagent activation 生命周期 | corum-subagent | 阶段 3 rebase 时对齐 activation 合并 | 3 |
| 2 | subagent-preset-composition | v0.2.1-alpha.1 | dsh-agent-presets → preset/agent-preset | corum-agent type import (:49/:37)、corum-subagent child-agent (:28)、corum-api-remotes dep | corum-agent, corum-subagent, corum-api-remotes | 阶段 1 改 dep+import + 阶段 3 rebase | 1+3 |
| 3 | jsonl-persistence-plugin | v0.2.1-alpha.1 | session-persistence-jsonl | SessionWriteLease 形态（0.1.5 已含，0.2.1 预编译 Node-API flock） | corum-subagent（间接依赖） | 阶段 3 rebase 时关注 + 阶段 4.5 addon 验证 | 3+4 |
| 4 | working-directory | v0.2.1-alpha.1 | session/working-directory, tool-working-directory | 待 grep 确认 | 待确认 | 待确认 | 待定 |
| 5 | session-title-provider-strategy | v0.2.1-alpha.1 | dsh-session-title-llm | desktop-host:105 dep、UI 元数据 (ide-ui:47-48, plugin-manager-ui:42-43) | corum-agent (dep:55, devDep:99, type import:67) | 阶段 1 迁移 provider API | 1 |
| 6 | session-title-adapters | v0.2.1-alpha.1 | dsh-session-title | 同上 | 同上 | 阶段 1 配对迁移 | 1 |
| 7 | plugin-engines-dsh | v0.2.1-alpha.1 | cordis-plugin-hmr → dsh-hmr | override 钉 cordis-plugin-hmr 1.0.17、组合行改名 | 全部 fork 包（热更新链路） | 阶段 1 替代 + 阶段 2 重算 override | 1+2 |
| 8 | from-default-profile-replaces-target | v0.2.1-alpha.1 | dsh-base / profile 组合 | profile/corum/ 组合文件 | 待确认 | 待确认 | 待定 |
| 9 | new-session-blank-reuse | v0.2.1-alpha.1 | session 控制器 | 待 grep 确认 | 待确认 | 待确认 | 待定 |
| 10 | remove-runtime-invariants | v0.2.0-rc.2 | dsh-invariants | 4 fork 包 invariant.ts + dep + external + desktop-host:86 + pnpm-workspace:155 | corum-goal-round-driver, corum-tool-subagent, corum-subagent, corum-tools | 方案 A 跟随删除（可行性文档 §三·1） | 1 |
| 11 | experimental-package-composition | v0.2.1-alpha.1 | 实验性包组合 | 待 grep 确认 | 待确认 | 待确认 | 待定 |
| 12 | _（逐篇补充其余约 29 篇）_ | _ | _ | _ | _ | _ | _ |

> **填表纪律**：
> - 「corum 引用点」列必须给出具体文件:行号（从评审报告 885858d9 取或 grep 确认），不能只写「有」。
> - 「归入阶段」列不能留空——要么写阶段号，要么写「corum 不受影响」。
> - 待确认项在执行时补全，不留空行。
