# 阶段 0：前置准备

> 状态：待开工 | 前置：阶段 -1（官方升级指南映射） | 预估工程量：约 0.5 人日（备份 + 守卫 + 快照记录）

## 1. 目标与范围

**目标**：在动任何代码之前，确保当前 0.1.5-rc.3 基线处于「可回滚」状态——完整备份 home
与工作区、确认 fork-drift 零漂移、记录基线快照供后续阶段对照、创建实录文件骨架。

**本阶段本质是「可回滚性的保证」**：不做任何代码修改，只做备份、快照、确认。

**范围**：
- 备份 `~/.corum`（用户 home 目录，含 sessions/settings/profiles/credentials）。
- 备份工作区（commit + push 当前所有 fork 包）。
- 跑 fork-drift 守卫确认 0.1.5-rc.3 基线零漂移。
- 确认 dsh 仓 tag `dsh-v0.2.1-rc.3` 存在（只读对比用，不必 checkout）。
- 记录当前基线快照（override 条目数、fork 包数、版本号）。
- 新建实录文件 `docs/UPGRADE-0.2.1-rc3.md` 骨架。
- 确认主实例 :9222 不在升级期间承载验证。

## 2. 前置条件（准入门禁）

| # | 条件 | 验证方式 | 状态 |
|---|---|---|---|
| 1 | 阶段 -1 退出门禁通过 | `01-official-guide-mapping.md` 附录 A 映射表已填全 | ☐ |
| 2 | 当前工作区在 `wt/wt-c288f9` 分支 | `git branch --show-current` | ☐ |
| 3 | dsh 仓可读 | `git -C /Users/kukucai/dsh tag -l 'dsh-v0.1.5-rc.3'` 返回非空 | ☐ |

## 3. 输入与依赖

| 输入 | 来源 | 用途 |
|---|---|---|
| 当前 home | `~/.corum/` | 备份源 |
| 当前工作区 | 本 worktree | commit + push |
| fork-drift 守卫脚本 | `./scripts/verify-fork-drift.sh` | 跑基线漂移检测 |
| dsh 仓 checkout | `/Users/kukucai/dsh` | 只读对比源（`DSH_CHECKOUT`） |
| 基线 tag | `dsh-v0.1.5-rc.3` | `DSH_BASELINE_TAG` |
| pnpm-workspace.yaml | 本仓 `pnpm-workspace.yaml` | 记录 override 基线条目数 |
| 实例脚本 | `./scripts/corum-instance.sh` | 验证实例管理 |

## 4. 执行步骤（命令级，逐步可执行，每步带验证命令）

### 步骤 1：完整备份 ~/.corum

```bash
# 备份整个 home 目录（含 sessions/settings/profiles/credentials/skills）
cp -a ~/.corum ~/.corum-backup-pre-0.2.1
```

**验证**：
```bash
# 确认备份目录存在且大小接近原目录
ls -ld ~/.corum-backup-pre-0.2.1
du -sh ~/.corum ~/.corum-backup-pre-0.2.1
# 两者大小应接近（差异仅来自备份期间的新增文件）
```

### 步骤 2：工作区全量 commit + push

```bash
# 确认工作区状态
git status

# 如有未提交改动，全部提交
git add -A
git commit -m "chore: 升级前基线快照（0.1.5-rc.3 → 0.2.1-rc.3 前夕）"

# 推送到远程
git push origin wt/wt-c288f9
```

**验证**：
```bash
# 工作区干净
git status --short
# 应输出空（无未提交改动）

# HEAD 已推送
git log --oneline -1
# 确认最新 commit 在远程存在
```

### 步骤 3：跑基线 fork-drift 守卫确认 0.1.5 零漂移

```bash
# 确认 0.1.5-rc.3 基线零漂移（升级前的「清白」基线）
DSH_CHECKOUT=/Users/kukucai/dsh \
DSH_BASELINE_TAG=dsh-v0.1.5-rc.3 \
./scripts/verify-fork-drift.sh
```

**验证**：
- 脚本退出码 = 0（`echo $?` 输出 `0`）。
- 输出中无「DRIFT DETECTED」或「FAIL」字样。
- 若有既存失败项（0.1.5 升级时已知 24 项既存 drift 与本次无关），在实录中记录具体项，不影响本阶段通过——但需确认这些失败项与 0.2.1 升级无关（是 0.1.5 基线固有的）。

> **注意**：若 fork-drift 守卫报红，**不要**直接进阶段 1。先确认失败项是否是既存的基线
> 漂移（参考 `docs/HANDOFF-2026-09-29-official-0.1.5-upgrade.md` §6 的「fork-drift 有
> 24 项既存失败与本事无关」记录）。若是新出现的漂移，说明 0.1.5 基线已不干净，需先修复。

### 步骤 4：确认 dsh 仓 tag dsh-v0.2.1-rc.3 存在

```bash
# 确认目标 tag 存在
git -C /Users/kukucai/dsh tag -l 'dsh-v0.2.1-rc.3'
# 应输出：dsh-v0.2.1-rc.3

# 确认 tag 指向的 commit
git -C /Users/kukucai/dsh rev-parse dsh-v0.2.1-rc.3
# 应输出 commit hash（1f81c047fc48fa190a683e469daa699857e9afe8）

# 注意：当前 dsh 仓检出可能停在 rc.2，不需要 checkout 到 rc.3
# 跨版本对比只需 git show 即可，不改变工作树
git -C /Users/kukucai/dsh rev-parse HEAD
# 确认当前 HEAD（不必等于 rc.3，只需 tag 存在即可用 git show）
```

**验证**：
- `git tag -l` 输出包含 `dsh-v0.2.1-rc.3`。
- `git rev-parse dsh-v0.2.1-rc.3` 输出有效 commit hash。
- **不要 checkout dsh 仓到 rc.3**——dsh 仓是只读对比源，用 `git show` 即可。

### 步骤 5：记录当前基线快照

将以下基线数据记入实录文件（步骤 6 创建骨架后填入）。这些数据是后续阶段验证「改了什么」的对照基准。

**5a. override 基线（pnpm-workspace.yaml）**

```bash
# 统计 overrides 段条目数（43-306 行）
sed -n '43,306p' pnpm-workspace.yaml | grep -c "^\s*@deepseek-ai\|^\s*[a-z]"
# 预期：217 条（评审报告 06867ebb §E1 核实）

# 统计 minimumReleaseAgeExclude 段条目数（307 行起）
sed -n '307,$p' pnpm-workspace.yaml | grep -c "@deepseek-ai"
# 预期：433 条（评审报告 06867ebb §E1 核实，全钉 0.1.3-alpha.1 陈旧）
```

**5b. fork 包基线**

```bash
# 统计 fork 包数
ls -d packages/plugins/agent/*/ packages/plugins/session/*/ packages/plugins/ui/*/ \
  | wc -l
# 预期：50 个（23 agent + 12 session + 15 ui）

# 逐组统计
echo "agent: $(ls -d packages/plugins/agent/*/ | wc -l)"
echo "session: $(ls -d packages/plugins/session/*/ | wc -l)"
echo "ui: $(ls -d packages/plugins/ui/*/ | wc -l)"
```

**5c. 版本号基线**

```bash
# desktop app 版本
grep '"version"' packages/desktop/package.json | head -1
# 预期：0.7.0

# cordis 版本
grep '"version"' vendor/cordis/package.json 2>/dev/null || \
  git -C /Users/kukucai/dsh show dsh-v0.1.5-rc.3:vendor/cordis/package.json | grep '"version"'
# 预期：4.0.2

# Electron 版本
grep '"electron"' packages/desktop/package.json | head -1
# 预期：43.4.1

# 基座版本（dsh 基线 tag）
echo "基座基线：dsh-v0.1.5-rc.3"
echo "目标版本：dsh-v0.2.1-rc.3"
```

**基线快照汇总表**（记入实录）：

| 维度 | 当前基线值 | 目标值 |
|---|---|---|
| dsh 基座 | 0.1.5-rc.3 | 0.2.1-rc.3 |
| desktop app | 0.7.0 | 待定 |
| cordis | 4.0.2 | 4.0.5 |
| Electron | 43.4.1 | 43.4.1（待阶段 4.5 决定是否升 44.7.0） |
| override 条目 | 217 条 | 约 250-300 条 |
| minimumReleaseAgeExclude | 433 条（全钉 0.1.3-alpha.1） | 待清理 |
| fork 包 | 50 个（23+12+15） | 50 个（rebase 后不变） |
| 官方包总数 | 278 | 362 |

### 步骤 6：新建实录文件 docs/UPGRADE-0.2.1-rc3.md 骨架

创建实录文件，写入骨架结构：

```markdown
# dsh 基座 0.1.5-rc.3 → 0.2.1-rc.3 升级实录

> 本文件记录升级全程的逐步执行实况。每个阶段执行时追加内容。
> 执行文档索引：docs/upgrade-0.2.1-rc3/README.md
> 可行性评估：docs/UPGRADE-0.2.1-rc3-feasibility.md

## 基线快照（阶段 0 记录）

| 维度 | 当前基线值 | 记录时间 |
|---|---|---|
| dsh 基座 | 0.1.5-rc.3 | <执行时填> |
| desktop app | <填> | |
| cordis | <填> | |
| Electron | <填> | |
| override 条目 | <填> | |
| fork 包 | <填> | |

## fork-drift 基线（阶段 0 记录）

- 守卫退出码：<填>
- 既存失败项：<填或「无」>

## 阶段 -1：官方升级指南映射

（执行时追加）

## 阶段 0：前置准备

- 备份时间：<填>
- 工作区 commit：<填 hash>
- fork-drift 结果：<填>

## 阶段 1：被删/更名包处理

（执行时追加）

## 阶段 2：override 重算

（执行时追加）

## 阶段 3：fork 包 rebase

（执行时追加）

## 阶段 4：三层验证

（执行时追加）

## 阶段 4.5：Electron 验证

（执行时追加）

## 阶段 5：装配进程隔离

（执行时追加）

## 阶段 6：顶层会话 sidecar

（执行时追加）
```

**验证**：
```bash
# 确认文件存在
ls -la docs/UPGRADE-0.2.1-rc3.md
# 确认骨架结构完整
grep -c "^## " docs/UPGRADE-0.2.1-rc3.md
# 应输出 9+（含基线快照 + 各阶段标题）
```

> **注意**：`docs/` 被 `.gitignore` 忽略，实录文件需 `git add -f docs/UPGRADE-0.2.1-rc3.md`
> 强制入库。

### 步骤 7：确认主实例 :9222 不承载验证

```bash
# 确认主实例在运行（但升级期间不用于验证）
# 主实例 :9222 是用户正在使用的实例，不可重启/杀掉
# 验证操作走 --home=verify 实例

# 确认实例脚本可用
ls -la scripts/corum-instance.sh

# 确认 verify 实例可用（不启动，只确认脚本支持 --home=verify）
scripts/corum-instance.sh --help 2>&1 | grep -- '--home'
# 应输出包含 --home 选项的帮助文本
```

**验证**：
- `scripts/corum-instance.sh` 存在且支持 `--home=<path>` 参数。
- 主实例 :9222 正常运行（用户在用）。
- **不启动验证实例**——本阶段只确认可用性，实际验证在阶段 4。

> **纪律**：主实例 :9222 是 MAIN 实例（角色：main），用户正在使用。升级全程不可重启或
> 杀掉主实例。验证操作一律走 `--home=verify` 实例（参考 `scripts/corum-instance.sh start
> --home=verify`）。

## 5. 验收标准（退出门禁，可判定）

| # | 标准 | 判定方式 | 状态 |
|---|---|---|---|
| 1 | `~/.corum` 已完整备份 | `ls -ld ~/.corum-backup-pre-0.2.1` 存在 | ☐ |
| 2 | 工作区干净且已 push | `git status --short` 输出空 + `git log --oneline -1` 在远程 | ☐ |
| 3 | fork-drift 守卫通过或既存失败已记录 | `./scripts/verify-fork-drift.sh` 退出码 0 或失败项已记入实录 | ☐ |
| 4 | dsh 仓 tag `dsh-v0.2.1-rc.3` 存在 | `git -C /Users/kukucai/dsh tag -l 'dsh-v0.2.1-rc.3'` 非空 | ☐ |
| 5 | 基线快照已记入实录 | 实录文件含基线快照表（override/fork/版本号） | ☐ |
| 6 | 实录文件骨架已创建 | `docs/UPGRADE-0.2.1-rc3.md` 存在且含各阶段标题 | ☐ |
| 7 | 主实例 :9222 不可重启的纪律已确认 | 实录中记录「验证走 --home=verify」 | ☐ |

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 备份期间 home 有活动写入导致备份不完整 | 低 | `cp -a` 是原子级拷贝；若担心可先停主实例（但通常不必，sessions 是 append-only JSONL） |
| fork-drift 守卫报红（非既存项） | 中 | 若是新漂移，说明 0.1.5 基线不干净，**不进阶段 1**，先修复漂移 |
| 工作区有 untracked 文件遗漏提交 | 低 | `git status` 确认干净；fork 包源码都在 `packages/plugins/` 下 |
| dsh 仓 checkout 被误改 | 低 | 只用 `git show` / `git ls-tree`，不 checkout；dsh 仓只读 |
| 实录文件忘记 `git add -f` | 中 | `docs/` 被 gitignore；提交时显式 `git add -f docs/UPGRADE-0.2.1-rc3.md` |

## 7. 回滚方案

**本阶段本质是「可回滚性的保证」，基线未动则无回滚需求。**

| 场景 | 回滚动作 |
|---|---|
| 步骤 1-2 失败（备份/提交未完成） | 无需回滚——本阶段未改任何代码，重做即可 |
| 步骤 3 fork-drift 报红 | 不回滚——基线本就如此，需判断是既存还是新漂移；新漂移则修复基线 |
| 步骤 4-7 失败 | 无代码改动，重做即可 |

**关键**：本阶段不修改任何源码、不修改 `pnpm-workspace.yaml`、不修改任何 `package.json`。
唯一可能写入的是实录文件 `docs/UPGRADE-0.2.1-rc3.md`（纯文档）。
若本阶段失败，意味着基线本身有问题，需要先修基线再重做本阶段。

## 8. 产出物与下游接口

| 产出物 | 位置 | 下游消费者 |
|---|---|---|
| home 备份 | `~/.corum-backup-pre-0.2.1/` | 全程——出问题时可恢复 |
| 工作区 commit | `wt/wt-c288f9` 分支 HEAD | 全程——基线代码快照 |
| fork-drift 基线结果 | 实录文件 §fork-drift 基线 | 阶段 4——验证时对比 drift 变化 |
| 基线快照表 | 实录文件 §基线快照 | 阶段 2——override 重算时对照 217→250-300 |
| 实录文件骨架 | `docs/UPGRADE-0.2.1-rc3.md` | 全程——各阶段执行时追加 |

**下游接口契约**：
- 阶段 1（`03-removed-packages.md`）的准入门禁第 1 条 = 本阶段退出门禁全部通过。
- 阶段 2（`04-overrides-lockfile.md`）的输入依赖基线快照表的 override 条目数（217 条）。
- 阶段 4（`06-verification.md`）的 fork-drift 验证对照本阶段记录的基线结果。

## 9. 实录要求（执行时往 `docs/UPGRADE-0.2.1-rc3.md` 记什么）

执行本阶段时，往实录文件记录以下内容：

1. **步骤 1**：备份命令 + 备份目录大小 + 耗时。
2. **步骤 2**：工作区 `git status` 输出 + commit hash + push 结果。
3. **步骤 3**：fork-drift 守卫的完整输出 + 退出码 + 既存失败项清单（如有）。
4. **步骤 4**：`git tag -l` 输出 + `git rev-parse dsh-v0.2.1-rc.3` 输出 + 当前 dsh HEAD。
5. **步骤 5**：基线快照表（override 条目数 / fork 包数 / 版本号 / 官方包总数）。
6. **步骤 6**：实录文件创建确认。
7. **步骤 7**：实例脚本可用性确认 + 「主实例不承载验证」纪律记录。
8. **偏差记录**：若实际数字与预期不符（如 override 不是 217 条），记录实际值与偏差原因。
9. **时间**：本阶段实际耗时。
