export interface DisplayPrefs {
  lineNumbers: 'on' | 'off' | 'relative'
  minimap: boolean
  renderWhitespace: 'none' | 'selection' | 'all'
  renderLineHighlight: 'none' | 'gutter' | 'line' | 'all'
  bracketPairColorization: boolean
  guides: boolean
  showFoldingControls: 'always' | 'mouseover'
  scrollBeyondLastLine: boolean
  smoothMotion: boolean
}

export const DEFAULT_DISPLAY_PREFS: Readonly<DisplayPrefs> = {
  lineNumbers: 'on', minimap: true, renderWhitespace: 'selection',
  renderLineHighlight: 'line', bracketPairColorization: true, guides: true,
  showFoldingControls: 'always', scrollBeyondLastLine: false, smoothMotion: true,
}

export function normalizeDisplayPrefs(value: unknown, fallback: Readonly<DisplayPrefs>): DisplayPrefs {
  const result = { ...fallback }
  if (typeof value !== 'object' || value === null) return result
  const raw = value as Record<string, unknown>
  for (const key of ['minimap', 'bracketPairColorization', 'guides', 'scrollBeyondLastLine', 'smoothMotion'] as const) {
    if (typeof raw[key] === 'boolean') result[key] = raw[key]
  }
  if (['on', 'off', 'relative'].includes(raw.lineNumbers as string)) result.lineNumbers = raw.lineNumbers as DisplayPrefs['lineNumbers']
  if (['none', 'selection', 'all'].includes(raw.renderWhitespace as string)) result.renderWhitespace = raw.renderWhitespace as DisplayPrefs['renderWhitespace']
  if (['none', 'gutter', 'line', 'all'].includes(raw.renderLineHighlight as string)) result.renderLineHighlight = raw.renderLineHighlight as DisplayPrefs['renderLineHighlight']
  if (['always', 'mouseover'].includes(raw.showFoldingControls as string)) result.showFoldingControls = raw.showFoldingControls as DisplayPrefs['showFoldingControls']
  return result
}
