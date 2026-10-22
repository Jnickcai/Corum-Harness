/** 编辑器显示偏好：client root 提供 Cordis 服务，存储适配器只负责持久化。 */
import type { editor } from 'monaco-editor'

import { DEFAULT_DISPLAY_PREFS, normalizeDisplayPrefs, type DisplayPrefs } from '../../shared/editor-display-prefs.ts'
export { DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from '../../shared/editor-display-prefs.ts'

export interface DisplayPrefsStore {
  getPrefs(): Readonly<DisplayPrefs>
  setPrefs(patch: Partial<DisplayPrefs>): void
  subscribe(listener: () => void): () => void
}

export function createDisplayPrefs(storage?: Pick<Storage, 'getItem' | 'setItem'>): DisplayPrefsStore {
  const key = 'corum.editor.displayPrefs'
  let prefs: Readonly<DisplayPrefs> = DEFAULT_DISPLAY_PREFS
  try {
    storage ??= globalThis.localStorage
    prefs = normalizeDisplayPrefs(JSON.parse(storage?.getItem(key) ?? 'null'), DEFAULT_DISPLAY_PREFS)
  } catch { /* 不可用或损坏的持久化回退默认值。 */ }
  const listeners = new Set<() => void>()
  return {
    getPrefs: () => prefs,
    setPrefs: patch => {
      const next = normalizeDisplayPrefs(patch, prefs)
      if ((Object.keys(next) as (keyof DisplayPrefs)[]).every(key => next[key] === prefs[key])) return
      prefs = next
      try { storage?.setItem(key, JSON.stringify(prefs)) } catch { /* 保留本次会话内设置。 */ }
      for (const listener of listeners) listener()
    },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
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
