/** 编辑器显示偏好：client root 提供 Cordis 服务，存储适配器只负责持久化。 */
import type { editor } from 'monaco-editor'

import { DEFAULT_DISPLAY_PREFS, normalizeDisplayPrefs, type DisplayPrefs } from '../../shared/editor-display-prefs.ts'
export { DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from '../../shared/editor-display-prefs.ts'

/**
 * 持久化适配器。`getItem` 同步、`hydrate`（可选）异步——桌面配置只能经 IPC 读，
 * 而**同步读不到**它：不把整个 client `apply` 变成 async，而是先 provide 默认值、
 * 再由调用方跑一次 `hydrate()`（见 `client/index.ts`）。
 *
 * 为什么这点重要：`apply` 一旦 await 一次 IPC 往返，排在它后面的通知桥、
 * 托盘未读数、编辑器槽位挂载全都要等那个 round-trip——三者与显示偏好无关。
 */
export interface DisplayPrefsStorage extends Pick<Storage, 'getItem' | 'setItem'> {
  /** 异步读回持久化值（桌面配置）；返回 undefined 表示「没有存储的值」。 */
  hydrate?: () => Promise<unknown>
}

export interface DisplayPrefsStore {
  getPrefs(): Readonly<DisplayPrefs>
  setPrefs(patch: Partial<DisplayPrefs>): void
  subscribe(listener: () => void): () => void
  /** 异步载入持久化值并通知订阅方；重复调用只生效第一次。 */
  hydrate(): Promise<void>
}

export function createDisplayPrefs(storage?: DisplayPrefsStorage): DisplayPrefsStore {
  const key = 'corum.editor.displayPrefs'
  let prefs: Readonly<DisplayPrefs> = DEFAULT_DISPLAY_PREFS
  try {
    storage ??= globalThis.localStorage
    prefs = normalizeDisplayPrefs(JSON.parse(storage?.getItem(key) ?? 'null'), DEFAULT_DISPLAY_PREFS)
  } catch { /* 不可用或损坏的持久化回退默认值。 */ }
  const listeners = new Set<() => void>()
  let hydrated: Promise<void> | null = null
  /**
   * 用户显式改过的键（hydrate 落地前）⇒ 以用户动作为准，异步值不得覆盖。
   * **按 key 记录而不是一个布尔**：只拨了「小地图」的话，其余八项仍应拿到
   * 磁盘上的值——否则一次误触就把整套显示设置退回默认（本条由测试抓出）。
   */
  const touchedKeys = new Set<keyof DisplayPrefs>()
  const notify = (): void => { for (const listener of listeners) listener() }
  return {
    getPrefs: () => prefs,
    setPrefs: patch => {
      const next = normalizeDisplayPrefs(patch, prefs)
      const changed = (Object.keys(next) as (keyof DisplayPrefs)[]).filter(key => next[key] !== prefs[key])
      if (changed.length === 0) return
      prefs = next
      for (const key of changed) touchedKeys.add(key)
      try { storage?.setItem(key, JSON.stringify(prefs)) } catch { /* 保留本次会话内设置。 */ }
      notify()
    },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    hydrate: () => {
      if (hydrated !== null) return hydrated
      hydrated = (async () => {
        if (storage?.hydrate === undefined) return
        const saved = normalizeDisplayPrefs(await storage.hydrate(), DEFAULT_DISPLAY_PREFS)
        const applied: DisplayPrefs = { ...saved }
        // 逐键保留用户改动；`Object.assign` 保持联合类型不被收窄成 never。
        for (const key of touchedKeys) Object.assign(applied, { [key]: prefs[key] })
        // 没有任何一项真的变了就不通知（避免无谓重渲染）。
        if ((Object.keys(applied) as (keyof DisplayPrefs)[]).every(key => applied[key] === prefs[key])) return
        prefs = applied
        notify()
      })()
      return hydrated
    },
  }
}

/** 源码与 diff 共用同一显示设置，切换文件无需重建编辑器。 */
export function displayOptions(prefs: Readonly<DisplayPrefs>): editor.IEditorOptions {
  return {
    lineNumbers: prefs.lineNumbers,
    minimap: { enabled: prefs.minimap },
    renderWhitespace: prefs.renderWhitespace,
    renderLineHighlight: prefs.renderLineHighlight,
    bracketPairColorization: { enabled: prefs.bracketPairColorization },
    guides: { bracketPairs: prefs.guides, indentation: prefs.guides },
    showFoldingControls: prefs.showFoldingControls,
    scrollBeyondLastLine: prefs.scrollBeyondLastLine,
    smoothScrolling: prefs.smoothMotion,
    cursorSmoothCaretAnimation: prefs.smoothMotion ? 'on' : 'off',
  }
}

// 同 bundle 实例桥；设置页跨 bundle 通过 Cordis 注入同一服务。
let instance: DisplayPrefsStore | undefined
export function setDisplayPrefsInstance(store: DisplayPrefsStore | undefined): void { instance = store }
export function getDisplayPrefsInstance(): DisplayPrefsStore | undefined { return instance }
