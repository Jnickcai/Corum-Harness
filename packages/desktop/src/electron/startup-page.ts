import type { StartupThemeInfo } from './startup-themes.ts'

export interface StartupPageOptions { theme: StartupThemeInfo; animationEnabled: boolean; preview: boolean; platform: string }

/** 零 host 依赖的播放器，主题本身没有桌面 bridge。 */
export function renderStartupPageHtml({ theme, animationEnabled, preview, platform }: StartupPageOptions): string {
  const config = JSON.stringify({ theme, animationEnabled, preview }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Corum · 正在启动</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{display:flex;flex-direction:column;background:${theme.background ?? '#050403'};color:#d8c090;font:13px Consolas,"Microsoft YaHei",monospace}
header{height:40px;flex:none;display:flex;align-items:center;padding-left:${platform === 'darwin' ? '80' : '16'}px;-webkit-app-region:drag;border-bottom:1px solid #3a2c16}
header span{flex:1}button{font:inherit;cursor:pointer;color:inherit;background:transparent;border:1px solid #6a5024;border-radius:6px;padding:6px 12px;-webkit-app-region:no-drag}
button:hover{background:#342714}button:focus-visible{outline:2px solid #ffc043;outline-offset:2px}
.window-controls{height:40px;display:flex}.window-controls button{width:46px;border:0;border-radius:0}.window-controls button:last-child:hover{background:#b91c1c}
main{position:relative;flex:1;min-height:0;display:grid;place-items:center}iframe,video{position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;object-fit:contain}
#waiting{padding:28px;max-width:700px;text-align:center;line-height:1.8}#status{white-space:pre-wrap;overflow-wrap:anywhere}
footer{height:48px;flex:none;display:flex;align-items:center;gap:16px;padding:0 20px;border-top:1px solid #3a2c16}#hint{flex:1;color:#ad966a}
[hidden]{display:none!important}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body>
<header ${preview ? 'hidden' : ''}><span>Corum Harness</span>${platform === 'darwin' ? '' : '<div class="window-controls"><button id="minimize" aria-label="最小化">−</button><button id="maximize" aria-label="最大化或还原">□</button><button id="close" aria-label="关闭">×</button></div>'}</header>
<main id="stage"><div id="waiting" role="status"><h1>Corum Harness</h1><p id="status">正在初始化后台服务…</p><button id="retry" hidden>重试启动</button></div></main>
<footer><span id="hint"></span><button id="skip">${preview ? '关闭预览' : '跳过动画'} <kbd>Esc</kbd></button></footer>
<script>
const config=${config};
const bridge=window.corumDesktop;
const stage=document.getElementById('stage'),status=document.getElementById('status'),hint=document.getElementById('hint'),skip=document.getElementById('skip'),retry=document.getElementById('retry');
let frame=null,video=null,holding=false,finished=false,failed=false,watchdog;
const source='corumapp://startup-theme/'+config.theme.id+'/'+config.theme.entry.split('/').map(encodeURIComponent).join('/');
function releaseMedia(){clearTimeout(watchdog);frame?.remove();frame=null;if(video){video.pause();video.removeAttribute('src');video.load();video.remove();video=null;}}
function stopAnimation(){if(finished||failed)return;finished=true;clearTimeout(watchdog);if(config.preview){hint.textContent='播放结束';return;}releaseMedia();skip.hidden=true;hint.textContent='';bridge.finishStartup();}
function mediaError(){if(finished||failed)return;releaseMedia();if(config.preview){finished=true;status.textContent='主题无法播放，请检查入口文件或视频编码。';return;}status.textContent='主题无法播放，正在继续启动…';stopAnimation();}
function skipMedia(){if(config.preview)bridge.closeStartupPreview();else stopAnimation();}
function showStatus(state){
 if(!state)return;
 if(state.phase==='error'){failed=true;releaseMedia();skip.hidden=true;hint.textContent='';status.textContent='启动失败：'+state.message;retry.hidden=false;}
 else if(state.phase==='ready')status.textContent='主界面已就绪，等待动画结束…';
}
document.getElementById('minimize')?.addEventListener('click',()=>bridge.minimizeWindow());
document.getElementById('maximize')?.addEventListener('click',()=>bridge.toggleMaximizeWindow());
document.getElementById('close')?.addEventListener('click',()=>bridge.closeWindow());
skip.addEventListener('click',()=>{if(!failed)skipMedia();});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!failed)skipMedia();});
stage.addEventListener('click',()=>{if(holding&&!failed&&!config.preview)stopAnimation();});
retry.addEventListener('click',()=>{retry.disabled=true;bridge.retryStartup();});
window.addEventListener('message',event=>{
 if(!frame||event.source!==frame.contentWindow||failed)return;
 if(event.data==='corum:startup-holding'||(config.theme.builtin&&event.data==='embedlink:startup-holding')){holding=true;hint.textContent=config.preview?'动画已到末帧':'点击画面进入工作区';}
 else if(event.data==='corum:startup-complete'||(config.theme.builtin&&event.data==='embedlink:startup-complete'))stopAnimation();
});
if(!config.preview){bridge.onStartupStatus(showStatus);bridge.getStartupStatus().then(showStatus);}
if((config.animationEnabled&&!matchMedia('(prefers-reduced-motion: reduce)').matches)||config.preview){
 if(config.theme.type==='video'){
  video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.src=source;
  video.addEventListener('loadedmetadata',()=>{if(!video||!Number.isFinite(video.duration)||video.duration<=0){mediaError();return;}clearTimeout(watchdog);watchdog=setTimeout(mediaError,(video.duration+10)*1000);});
  video.addEventListener('ended',stopAnimation);video.addEventListener('error',mediaError);stage.append(video);watchdog=setTimeout(mediaError,10000);video.play().catch(mediaError);
 }else{
  frame=document.createElement('iframe');frame.title='启动主题动画';frame.setAttribute('sandbox','allow-scripts');frame.tabIndex=-1;frame.setAttribute('aria-hidden','true');frame.src=source;frame.addEventListener('error',mediaError);stage.append(frame);watchdog=setTimeout(mediaError,45000);
 }
 skip.focus();
}else{stopAnimation();}
window.addEventListener('pagehide',releaseMedia);
</script></body></html>`
}
