---
name: corum-startup-theme-dev
description: Use when making a Corum startup theme (the animated splash shown while the desktop boots) — the ZIP structure, manifest.json format, HTML/video theme development, the CorumStartup SDK API (onStatus/finish/getStatus/fail), the CSP limits, the import-time static-scan rejections, the packaging limits, and the color/font reference. Covers both hand-written HTML themes and Remotion-rendered MP4 themes.
---

# corum 启动主题开发（主题技能）

本技能教你在 corum 桌面应用里**制作一个启动主题动画**。启动主题是应用冷启动时
显示的过渡画面：主进程在后台唤醒 Agent、装配插件、挂载主界面，主题动画在此期间播放，
主界面就绪后动画收尾、切进工作区。

事实源：协议路由 `packages/desktop/src/electron/protocol.ts`、
CSP `packages/desktop/src/electron/startup-theme-resource.ts`、
导入校验 `packages/desktop/src/electron/startup-themes.ts`、
SDK `packages/desktop/assets/corum-startup-sdk.js`、
内置主题 `packages/desktop/assets/startup-segments/`（分段视频）。
代码变了以代码为准，回来修本技能。

## 1. 一句话

**主题是一个 ZIP，运行在 sandbox iframe 里，经 `CorumStartup` SDK 通知应用「我放完了」。
SDK 由应用运行时提供（不打进 ZIP），保证你调的能力面和应用版本匹配。外部资源一律打进
ZIP，用 `corumapp://startup-theme/<id>/<file>` 引用。**

## 2. ZIP 结构

```
my-theme.zip
├── manifest.json          # 必需，根目录
├── content/
│   └── index.html         # HTML 主题入口（manifest.entry 指向它）
│   └── style.css          # 可选，你的 CSS
│   └── logo.svg           # 可选，图片/字体/音频都行
├── preview.png            # 可选，主题管理页的缩略图（manifest.preview）
└── ...                    # 其他资源
```

打包限制（`startup-theme-archive.ts`，硬约束，超了导入直接失败）：

| 限制 | 值 |
|---|---|
| ZIP 压缩大小 | ≤ 200 MiB |
| 解压后总大小 | ≤ 400 MiB |
| 文件 + 目录数量 | ≤ 2048 |
| 校验 | 每个文件 CRC32 + 本地头与目录一致性 |
| 路径 | 只允许相对路径，禁 `..`、`\`、`:`、控制字符、Windows 保留名（CON/PRN/AUX…）、尾空格/尾点；不重复、不重叠、不 symlink |

视频主题同理，把 MP4/WebM 当 entry 即可。

## 3. manifest.json 格式

```json
{
  "formatVersion": 1,
  "id": "my-aurora",
  "name": "极光启动",
  "version": "1.0.0",
  "type": "html",
  "entry": "content/index.html",
  "background": "#0A0612",
  "preview": "preview.png",
  "author": "your-name"
}
```

| 字段 | 必需 | 说明 |
|---|---|---|
| `formatVersion` | 是 | 固定 `1`（当前唯一规范版本） |
| `id` | 是 | 小写字母/数字/`._-` 开头，≤63 字符；不能与内置 `corum-terminal` 冲突；安装后即目录名 |
| `name` | 是 | 主题显示名 |
| `version` | 是 | 语义版本字符串 |
| `type` | 是 | `'html'` 或 `'video'` |
| `entry` | 是 | 入口文件相对路径；html 主题须 `.html`，视频主题须 `.mp4`/`.webm` |
| `background` | 否 | 背景色 `#RRGGBB`（加载前的底色） |
| `preview` | 否 | 缩略图相对路径；`.png`/`.jpg`/`.jpeg`/`.webp` |
| `author` | 否 | 作者名 |

## 4. HTML 主题开发

### 4.1 引入 SDK

主题 HTML **不要**把 SDK 代码复制进来。用协议引用，应用运行时会注入匹配版本的 SDK：

```html
<script src="corumapp://startup-sdk/corum-startup-sdk.js"></script>
```

CSP 已放行 `corumapp://startup-sdk`，所以这个 `<script src>` 能加载。

### 4.2 监听启动阶段 + 通知完成

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>我的启动主题</title>
<style>/* 你的 CSS，可引 corumapp://startup-theme/<id>/style.css */</style>
</head>
<body>
<div id="stage">…你的动画…</div>
<div id="phase">检查环境</div>
<script src="corumapp://startup-sdk/corum-startup-sdk.js"></script>
<script>
// 1. 订阅启动状态（每次主进程推进阶段都会回调）
CorumStartup.onStatus((status) => {
  // status = { phase, stage?, progress?, message? }
  // phase: 'loading' | 'ready' | 'error'
  // stage:  'env' | 'spawn' | 'plugins' | 'mounting'（仅 loading 时有）
  // progress: 0~100（可选）
  // message: 文本（error 时有）
  if (status.phase === 'ready') {
    // 主界面已就绪 —— 收尾动画后调 finish()
    finishAnimation();
  } else if (status.phase === 'error') {
    document.getElementById('phase').textContent = '启动失败：' + (status.message ?? '');
  } else {
    // loading：按 stage 切阶段文案
    if (status.stage) document.getElementById('phase').textContent = STAGE_TEXT[status.stage] ?? status.stage;
    if (typeof status.progress === 'number') updateProgress(status.progress);
  }
});

// 2. 动画放完后通知应用进入主界面
function finishAnimation() {
  CorumStartup.finish();   // 幂等，多次调用只生效一次
}

// 3. （可选）查一次性快照
CorumStartup.getStatus().then(s => { if (s) console.log('当前状态', s); });
</script>
</body>
</html>
```

### 4.3 status 对象

```typescript
{
  phase: 'loading' | 'ready' | 'error',
  stage?: 'env' | 'spawn' | 'plugins' | 'mounting',   // 仅 loading
  progress?: number,   // 0~100
  message?: string,    // error 时的说明
}
```

### 4.4 阶段映射（stage → 建议文案）

| stage | 含义 |
|---|---|
| `env` | 检查环境 |
| `spawn` | 唤醒 Agent |
| `plugins` | 装配插件 |
| `mounting` | 基本就绪 |

### 4.5 跳过

用户按 **Esc** 或**点击画面**会自动触发 `finish()`（由应用层 startup-page 处理，主题无需自己监听）。
主题只管：**动画到末帧 / 收到 `phase:'ready'` → 调 `CorumStartup.finish()`**。

### 4.6 失败

如果你的主题自己判断无法继续（极少见），调 `CorumStartup.fail(message)` 请求重试；
但更常见的是**应用层**推 `phase:'error'`——这时主题应显示失败态、别自己 finish（用户会手动重试）。

## 5. SDK API 列表

SDK 全局对象 `window.CorumStartup`，由 `corumapp://startup-sdk/corum-startup-sdk.js` 提供。

| API | 作用 | 桌面环境 | 非桌面/预览兜底 |
|---|---|---|---|
| `CorumStartup.version` | SDK 版本字符串（`'1.0.0'`） | ✓ | ✓ |
| `CorumStartup.onStatus(cb)` | 订阅启动状态，返回取消函数 | 调 `corumDesktop.onStartupStatus` | 空操作（不报错） |
| `CorumStartup.finish()` | 通知动画结束 | 调 `corumDesktop.finishStartup()` | `parent.postMessage('corum:startup-complete')` |
| `CorumStartup.getStatus()` | 取状态快照 Promise | 调 `corumDesktop.getStartupStatus()` | `Promise.resolve(undefined)` |
| `CorumStartup.fail(msg?)` | 请求重试 | 调 `corumDesktop.retryStartup()` | 空操作 |

**SDK 只包装现有 preload 能力，不加新能力。** 所有方法幂等、缺失 bridge 时不抛错。

## 6. 视频主题开发

更简单——一个视频文件 + manifest 即可，无需 SDK：

```json
{
  "formatVersion": 1, "id": "my-clip", "name": "片头", "version": "1.0.0",
  "type": "video", "entry": "content/intro.mp4", "background": "#000000"
}
```

- 格式：**MP4（H.264）或 WebM（VP9/VP8）**，Chromium 原生支持。
- 主题被 `<video muted playsInline>` 播放，`ended` 自动 finish。
- 视频主题**不走 SDK**（sandbox iframe 只用于 HTML 主题）。
- 想用程序化动画生成视频？见 §9 Remotion。

## 7. CSP 限制

主题 HTML 运行在 sandbox iframe（`sandbox="allow-scripts"`，**无** `allow-same-origin`），
响应头 CSP 为：

```
default-src 'none';
script-src 'unsafe-inline' corumapp://startup-theme corumapp://startup-sdk;
style-src 'unsafe-inline' corumapp://startup-theme;
img-src data: blob: corumapp://startup-theme;
font-src data: corumapp://startup-theme;
media-src corumapp://startup-theme;
connect-src corumapp://startup-theme;
frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';
```

含义：
- **所有外部资源只能来自 `corumapp://startup-theme/<id>/...` 或 `corumapp://startup-sdk/...`**——把它们打进 ZIP。
- 内联 `<script>` / `<style>` 允许（`'unsafe-inline'`）。
- **不能** `fetch`/`XMLHttpRequest` 任何 http(s)、不能加载外部脚本/字体/图片、不能嵌 iframe/object/embed。

## 8. 导入时静态扫描会拒绝的模式

导入主题时（`importStartupTheme`）会对 HTML 入口做正则静态扫描，命中即拒绝导入并报错。
这是「提前挡 + 给明确错误」，**不替代 sandbox+CSP**（那才是真正的运行期安全屏障）。

| 模式 | 错误 |
|---|---|
| `<iframe` | 禁止嵌套框架 |
| `<object` | CSP object-src none |
| `<embed` | CSP object-src none |
| `require(` | 禁止 Node 模块加载 |
| `import … https://…` | 禁止 ESM 外部导入（只允许 corumapp://） |
| `fetch('http(s)://…')` | 禁止外部网络请求 |
| `XMLHttpRequest` | 禁止外部网络请求 |
| `<script src="http(s)://…">` | 禁止外部脚本 |
| `<link href="http(s)://…">` | 禁止外部 CSS |

> 静态扫描是正则级，不保证运行期安全；sandbox（allow-scripts only）+ CSP（default-src none）才是真正的安全屏障。

## 9. 内置主题与 Remotion 参考

### 9.1 内置主题：`corum-terminal`（分段视频，唯一内置）

`packages/desktop/assets/startup-segments/segments/*.mp4` —— 每个启动阶段一段：
`env/plugins/mounting` 在阶段内无缝循环，`ready` 一次播完汇聚 + 发光扫描。
描述符是 `startup-themes.ts` 的 `BUILTIN`（`id: 'corum-terminal'`、`name: '代码成团'`、
`version: 2.0.0`、`type: 'video'`）。**这是应用唯一自带、默认播放的主题**——
id 沿用历史的 `corum-terminal`，是为了保住存量偏好文件与「内置不可删」规则。

> ⚠️ `spawn` 阶段已于 2026-10-17 并入 `env`：阶段枚举现在是
> `env | plugins | mounting | ready`（四段，`ALL_STAGES`）。
> **带 `spawn` 段的旧主题包会被直接拒绝**（`validateSegments` 对不在枚举里的 stage 抛
> 「segment stage 无效」），不是忽略——所以升级前做的主题要先把那段的 `stage` 改成
> `env` 才能导入。另：`segments` 必须非空且**含 `ready` 段**。

旧的内置 HTML 动画（`startup-terminal.html`）**已下线**，应用不再自带 HTML 主题；
但 `type: 'html'` 仍是受支持的导入格式。`startup-theme-kit/` 模板目录**也已删除**，
写 HTML 主题请照本技能 §11 的最小模板起步。若要参考旧实现，历史版本仍在：
`git show 84f289f3^:packages/desktop/assets/startup-terminal.html`。

### 9.2 Remotion 工程（**装在 corum-dev 扩展包里，可直接跑**）

一份完整可运行的 Remotion 工程随「Corum 开发」扩展包（`corum-dev-preset`）的技能目录分发：

```
$CORUM_HOME/skills/corum-startup-theme-dev/plugins/remotion-starter/
```

它渲染的正是应用当前那支启动动画（3D 星隧 → 代码粒子汇聚 → 「Corum Harness」→ 就绪）。
实测出的规格：**1920×1080 · 30 fps · 240 帧（8 s）· H.264 + AAC**。

> ⚠️ **它不在应用仓里**（这句是为了别让人在 kkc-desktop 里白找路径）。
> 2026-10-16 用户拍板从应用仓移除，原话「用这个工具制作动画并不想让其成为一个插件或者组件」
> ⇒ 现在它只在扩展包里，应用仓**没有** `packages/desktop/startup-theme-remotion/`。
> 要取回当年那份源码：`git show d0988b76^:packages/desktop/startup-theme-remotion/`。
> 先确认工程在不在：`ls "$CORUM_HOME/skills/corum-startup-theme-dev/plugins/remotion-starter"`。

```bash
cd "$CORUM_HOME/skills/corum-startup-theme-dev/plugins/remotion-starter"
npm install                         # 用 npm，不要 pnpm（原因见下表）
node render.mjs --theme             # 出 MP4 + 直接可导入的主题 ZIP
```

产物：`dist/startup-animation.mp4` 与 `dist/corum-remotion-theme.zip`（后者可
**设置 → 外观 → 启动动画 → 导入主题** 直接装入）。

改动画就改 `src/`（`StartupAnimation.tsx` 是时间轴总装，`CodeParticles`/`StarField`/
`TextConverge` 是三层 3D，`audio.ts` 是琶音）。改主题身份用
`node pack-theme.mjs --id=… --name=… --author=…`。

**四个已实测的坑**（工程 README 里有完整版，这里只列判据）：

| 现象 | 真因 | 修法 |
|---|---|---|
| `No browser found for rendering frames!` | Remotion 自带的解压器把 chrome-headless-shell 只解出 ABOUT/LICENSE，且**下次会跳过重解** | `render.mjs` 已内置自愈（判据是**可执行文件存在**，不是目录存在）；手工修见 README |
| 3D 层整片黑但渲染「成功」 | 无头 Chrome 拿不到 WebGL 上下文 | `remotion.config.ts` 的 `setChromiumOpenGlRenderer('angle-egl')` 不能删 |
| `Invalid hook call` 之类运行期错 | 与本仓工作区混装了 React | `pnpm install --ignore-workspace` |
| `ERR_PNPM_IGNORED_BUILDS`（反复出现） | **pnpm 会把 `pnpm-workspace.yaml` 的 `allowBuilds` 覆写回占位符** `set this to true or false` | 改用 `npm install`；这条警告本身**无害**（实测不批准 esbuild 也能渲染成功） |

**主题 ZIP 的硬约束**（`pack-theme.mjs` 已按应用同规自检，自己改打包脚本时照抄）：
ZIP ≤200 MiB / 解压 ≤400 MiB / ≤2048 项；拒绝 ZIP64、多卷、加密、数据描述符；
`manifest.json` 在根且 `formatVersion:1`；`type:'video'` 的 entry 必须 `.mp4|.webm`；
主题 id 匹配 `^[a-z0-9][a-z0-9._-]{0,63}$` 且不能撞内置 `corum-terminal`；
路径禁 `..`/反斜杠/冒号/控制字符/Windows 保留名/尾空格尾点。

## 10. 配色与字体参考

| 用途 | 值 |
|---|---|
| 深紫黑底 | `#0A0612` |
| 主紫 | `#5B21F5` |
| 浅紫 | `#B98CFF` |
| 青 | `#01CDFE` |
| 粉 | `#FF71CE` |
| 次要文字 | `#7B6896` |
| UI 字体 | Inter, -apple-system, PingFang SC, SF Pro Text, system-ui |
| 等宽字体 | JetBrains Mono, SF Mono |

背景建议用 `linear-gradient(135deg, #0A0612 0%, #120820 40%, #0E0A18 70%, #0A0612 100%)`，
配紫/青/粉三色高斯模糊光晕（`filter: blur(80px); opacity: 0.05~0.12`）。
尊重 `@media (prefers-reduced-motion: reduce)`：减/关动画。

## 11. 最小可用主题模板

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0A0612;color:#fff;
    font:14px Inter,-apple-system,sans-serif;display:grid;place-items:center}
  .phase{font-size:13px;color:#B98CFF;letter-spacing:1px;font-family:'JetBrains Mono',monospace}
</style></head>
<body>
<div class="phase" id="phase">检查环境</div>
<script src="corumapp://startup-sdk/corum-startup-sdk.js"></script>
<script>
const STAGE={env:'检查环境',spawn:'唤醒 Agent',plugins:'装配插件',mounting:'基本就绪'};
let done=false;
function finish(){ if(done) return; done=true; CorumStartup.finish(); }
CorumStartup.onStatus(s=>{
  if(s.phase==='ready'){ document.getElementById('phase').textContent='就绪'; setTimeout(finish,600); }
  else if(s.phase==='error'){ document.getElementById('phase').textContent='启动失败'; }
  else if(s.stage){ document.getElementById('phase').textContent=STAGE[s.stage]||s.stage; }
});
// 兜底：5s 内没收到 ready 也自动收尾（避免卡死）
setTimeout(finish, 5000);
</script>
</body></html>
```

manifest:
```json
{"formatVersion":1,"id":"my-min","name":"极简","version":"1.0.0","type":"html","entry":"content/index.html","background":"#0A0612","author":"me"}
```

打包：把 `manifest.json` 和 `content/index.html` 压成 ZIP（根目录即 manifest 所在层），
在「设置 → 启动主题 → 导入」里选这个 ZIP 即可。
