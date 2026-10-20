/**
 * 「终端」区域的替换实现（测试插件）。
 *
 * 一个假终端：可输入命令、回车追加一行「回显 + 时间戳」。它验证的是
 * **交互在替换后的区域里照常工作**（React 事件、按钮、键盘都接得住），
 * 这比「能显示一段静态文字」强得多 —— 区域替换最容易出的问题就是事件层被壳吞掉。
 *
 * @module @corum-examples/region-replacement/client/TerminalReplacement
 */

import { useCallback, useMemo, useRef, useState } from 'react'

interface Line {
  readonly at: string
  readonly text: string
  readonly kind: 'echo' | 'info'
}

const S = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: 'var(--corum-glass-1)',
    borderTop: '1px solid var(--corum-glass-border)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    borderBottom: '1px solid var(--corum-glass-border)',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: '11.5px',
  },
  dot: { width: '8px', height: '8px', borderRadius: '999px', background: '#4ade80' },
  log: { flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '2px' },
  line: { color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  info: { color: 'var(--dsw-alias-label-tertiary)' },
  inputRow: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderTop: '1px solid var(--corum-glass-border)' },
  prompt: { color: 'var(--dsw-alias-label-tertiary)' },
  input: {
    flex: 1,
    minWidth: 0,
    background: 'transparent',
    border: '0',
    outline: 'none',
    color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
} as const

/** 「终端」区域的替换面板。 */
export function TerminalReplacement(): React.JSX.Element {
  const boot = useMemo<readonly Line[]>(() => [{
    at: new Date().toLocaleTimeString(),
    kind: 'info',
    text: 'region-replacement: 已接管 corum.panel（priority -1）。原 occupant 是 corum-terminal 的 PTY 面板。',
  }, {
    at: new Date().toLocaleTimeString(),
    kind: 'info',
    text: '试一下：在下面输入任意内容回车 —— 输入事件必须能穿过壳到达本插件。',
  }], [])

  const [lines, setLines] = useState<readonly Line[]>(boot)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const submit = useCallback(() => {
    const text = draft.trim()
    if (text === '') return
    setLines(prev => [...prev, { at: new Date().toLocaleTimeString(), kind: 'echo', text: `$ ${text}` }])
    setDraft('')
    inputRef.current?.focus()
  }, [draft])

  return (
    <div style={S.body} data-replacement="terminal">
      <div style={S.head}>
        <span style={S.dot} />
        <span>测试插件 · 已接管「终端」区域</span>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>corum.panel · priority -1</span>
      </div>
      <div style={S.log}>
        {lines.map((line, index) => (
          <div key={`${line.at}-${index}`} style={{ ...S.line, ...(line.kind === 'info' ? S.info : {}) }}>
            <span style={{ opacity: 0.55 }}>{line.at} </span>{line.text}
          </div>
        ))}
      </div>
      <div style={S.inputRow}>
        <span style={S.prompt}>$</span>
        <input
          ref={inputRef}
          style={S.input}
          value={draft}
          placeholder="输入后回车…"
          aria-label="测试插件终端输入"
          onChange={event => { setDraft(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
        />
      </div>
    </div>
  )
}
