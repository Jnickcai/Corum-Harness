# hello-plugin —— 第三方插件最小样例

只依赖 `@corum/plugin-sdk`（运行时）+ `@corum/plugin-build`（构建），**不含也不改宿主任何文件**。

```bash
pnpm install
pnpm --filter @corum-examples/hello-plugin run build
# lib/index.js（宿主半 ESM）+ lib/client.js（__ModuleLoader__ 闭包）
```

三步看懂它：

| 文件 | 说明 |
|---|---|
| `package.json` | `exports` 词典、`dsh.client`、`dsh.bundle.patch`、依赖分层（SDK 在 deps、基座在 peer） |
| `tsdown.config.ts` | 三行：`definePluginBundle({ id, client })` —— banner/externals/CSS 全由构建包保证 |
| `cordis.patch.yml` | `insert` 不带 id ⇒ 挂到组件树根，不需要知道宿主 row id |

完整说明：`docs/plugin-template.md`；规则：`docs/PLUGIN-SPEC.md`。
