# Corum 启动主题制作

主题使用 **Corum Startup Theme v1**。将主题目录内的内容打为 ZIP，确保根目录直接包含 UTF-8 `manifest.json`。在 Corum 的“设置 → 外观 → 启动”导入、预览并选择；选择下次启动生效。

## 模板与打包

- `html/` 是可以直接使用的 HTML 示例，包含一个 3 秒动画。
- `video/` 是视频模板，先把自己的视频放入 `content/`，并按需修改 `entry`。
- `theme.schema.json` 可用于编辑器的 JSON Schema 校验。

内置启动动画是**分段视频**（`../assets/startup-segments/`，见 `../startup-theme-remotion/`）。
Corum 不再自带 HTML 动画，但 `type: 'html'` 仍是受支持的导入格式——从 `html/` 模板
起步即可（模板里已接好 `corum:` 消息前缀）。若要参考完整实现，可以看旧版动画的历史
版本：`git show 84f289f3^:packages/desktop/assets/startup-terminal.html`。

可以手动压缩目录内文件。项目已经安装依赖并构建 desktop 后，也可以在本目录执行：

```powershell
node pack.mjs html E:/my-theme.zip
node pack.mjs video E:/my-video-theme.zip
```

## manifest 字段

必填：`formatVersion: 1`、唯一 `id`、显示 `name`、主题 `version`、`type`（`html` 或 `video`）、入口 `entry`。可选：`author`、预览图 `preview`、十六进制背景色 `background`。

`id` 长度 1–64，使用小写字母、数字、`.`、`_`、`-`，首字符为字母或数字，不能以 `.` 结尾或使用 Windows 保留名称。`corum-terminal` 为内置 ID，不能用来导入。

资源路径以 `/` 分隔，必须是包内相对文件路径；不能包含 `..`、盘符、反斜杠、链接或 Windows 特殊文件名。文件名大小写不应冲突。预览图支持 PNG/JPEG/WebP。

ZIP 最大 200 MiB，解压总量最大 400 MiB，最多 2048 个资源条目（包含目录）。支持普通 ZIP 的 Stored/Deflate 压缩；不支持加密、多卷和 ZIP64。重复 ID 会被拒绝，替换前先删除旧主题。

## HTML 播放协议

动画和资源应全部放在主题包内，支持本地 HTML/CSS/JavaScript、Canvas、图片和字体。主题在隔离 iframe 中运行，没有 Node.js 或 Electron IPC 能力，不能访问外部网络。

动画播放完成后发送：

```javascript
window.parent.postMessage('corum:startup-complete', '*')
```

如果设计了末帧停留，可以在开始停留时发送：

```javascript
window.parent.postMessage('corum:startup-holding', '*')
```

此时用户可点击画面结束停留；主题仍应在自己的停留时间结束时发送 complete。没有完成通知的 HTML 在 45 秒后回退到加载提示。

## 视频与结束规则

支持 MP4/WebM 容器，实际编码兼容性以 Corum 内预览结果为准。视频须包含有效时长元数据，默认静音、不循环、保持比例。加载 10 秒无结果或播放失败时，Corum 回退到基础加载画面。

主题播放结束且主界面就绪后才进入；播放结束早于后台时继续显示加载状态。用户可随时按 Esc 跳过媒体。预览不更改当前主题，结束后保留画面，Esc 关闭预览。
