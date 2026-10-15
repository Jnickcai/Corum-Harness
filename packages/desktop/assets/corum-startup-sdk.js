// Corum Startup SDK v1.0.0 (provided by corum runtime)
//
// 主题 HTML 通过 <script src="corumapp://startup-sdk/corum-startup-sdk.js"> 引用。
// 本文件由应用运行时经 corumapp://startup-sdk 协议提供（不打进主题 ZIP），
// 保证主题调用的能力面与当前应用版本匹配。
//
// 作用：包装 window.corumDesktop 的启动能力子集，给主题开发者一个稳定、
// 带兜底的最小 API。不在桌面环境（如本地预览 HTML）时退化为空操作，
// 不报错、不阻塞动画播放。
(function () {
  'use strict'

  var VERSION = '1.0.0'

  // 读 preload contextBridge 暴露的桥；预览/非桌面环境下可能不存在或只有
  // closeStartupPreview。SDK 只关心启动能力子集，缺失的方法走兜底。
  function bridge() {
    return (typeof window !== 'undefined' && window.corumDesktop) ? window.corumDesktop : null
  }

  function has(name) {
    var b = bridge()
    return !!b && typeof b[name] === 'function'
  }

  /**
   * 订阅启动状态回调。每次主进程推进阶段都会回调 status。
   * @param {(status: {phase:'loading'|'ready'|'error', stage?:'env'|'spawn'|'plugins'|'mounting', progress?:number, message?:string}) => void} callback
   * @returns {() => void} 取消订阅函数。非桌面环境下返回空操作。
   */
  function onStatus(callback) {
    if (typeof callback !== 'function') return function () {}
    if (has('onStartupStatus')) return bridge().onStartupStatus(callback) || function () {}
    // 兜底：无桥（本地预览）→ 不订阅，返回空操作
    return function () {}
  }

  /**
   * 通知应用启动动画结束，进入主界面。幂等（多次调用只生效一次）。
   * 桌面环境调 finishStartup()；非桌面环境用 parent.postMessage 兜底
   * （供应用层 startup-page.ts 识别完成信号）。
   */
  function finish() {
    if (has('finishStartup')) { bridge().finishStartup(); return }
    try { if (typeof parent !== 'undefined' && parent) parent.postMessage('corum:startup-complete', '*') } catch (e) { /* 跨域受限，静默 */ }
  }

  /**
   * 查询当前启动状态（一次性快照）。桌面环境返回 Promise<status|undefined>；
   * 非桌面环境返回 Promise.resolve(undefined)。
   * @returns {Promise<{phase:string,stage?:string,progress?:number,message?:string}|undefined>}
   */
  function getStatus() {
    if (has('getStartupStatus')) return Promise.resolve(bridge().getStartupStatus())
    return Promise.resolve(undefined)
  }

  /**
   * 通知启动失败并请求重试。桌面环境调 retryStartup()；不可用时为空操作。
   * @param {string} [message] 失败提示（当前仅作日志用途，不强制）
   */
  function fail(message) {
    if (has('retryStartup')) { bridge().retryStartup(); return }
    // 兜底：无重试能力 → 不做事，主题应自行决定是否直接 finish()
    void message
  }

  var CorumStartup = {
    version: VERSION,
    onStatus: onStatus,
    finish: finish,
    getStatus: getStatus,
    fail: fail,
  }

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'CorumStartup', { value: CorumStartup, writable: false, configurable: false })
  } else {
    // 非 window 环境（理论上不会发生，因为 SDK 在 iframe 里跑）→ 挂到 this
    this.CorumStartup = CorumStartup
  }
})()
