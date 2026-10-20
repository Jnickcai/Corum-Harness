/**
 * 设置 ›「扩展」里的测试插件设置页。
 *
 * 它验证的是「插件能在设置里拥有自己的一页」：壳把 `settings.section` 当 **list 槽**，
 * 插件的注册 id 不在壳的已知表里 ⇒ 壳的分组解析 `navGroupOf()` 缺省归 **extensions（扩展）**。
 *
 * 页面里放一个**真持久化**的偏好（`localStorage`），编辑器面板读它决定是否显示主题取样 ——
 * 证明「设置页写、面板读」这条跨区域链路成立（同 bundle 内，不涉及跨 bundle 状态，红线 1 无涉）。
 *
 * @module @corum-examples/region-replacement/client/SettingsPage
 */

import { useCallback, useEffect, useState } from 'react'
import type { SettingsSectionOwnerProps } from '@corum/plugin-ui-contract'
import type { SessionFactsSnapshot } from '@corum/plugin-sdk/client'

/** 偏好键（编辑器面板读同一键）。 */
export const SHOW_TOKENS_KEY = 'region-replacement.showThemeTokens'

/** 桌面桥窄化面（Web 版没有，静默降级）。 */
interface DesktopBridge {
  getPlatform?: () => string
  getAppVersion?: () => Promise<string>
}

function bridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { corumDesktop?: DesktopBridge }).corumDesktop
}

const S = {
  page: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 2px', color: 'var(--dsw-alias-label-primary)' },
  card: {
    padding: '12px 14px',
    borderRadius: '12px',
    background: 'var(--corum-glass-1)',
    border: '1px solid var(--corum-glass-border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  h: { margin: 0, fontSize: '13px', fontWeight: 600 },
  p: { margin: 0, fontSize: '12px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' },
  row: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' },
  hint: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
} as const

/**
 * 测试插件的设置页。
 * @param props - 壳下发的 owner props（`close`）+ 本插件注入面（本页不用）。
 * @returns 设置页内容。
 */
/** 设置页的注入面（由 client/index.ts 提供：读会话资源 + 列工具面）。 */
export interface SettingsInjected {
  readFacts: () => Promise<SessionFactsSnapshot>
  listTools: () => Promise<readonly string[]>
}

export function RegionReplacementSettings(props: SettingsSectionOwnerProps & Partial<SettingsInjected>): React.JSX.Element {
  const [showTokens, setShowTokens] = useState<boolean>(() => {
    try { return window.localStorage.getItem(SHOW_TOKENS_KEY) === '1' } catch { return false }
  })
  const [appVersion, setAppVersion] = useState<string | undefined>(undefined)
  const [facts, setFacts] = useState<SessionFactsSnapshot | undefined>(undefined)
  const [factsError, setFactsError] = useState<string | undefined>(undefined)
  const [tools, setTools] = useState<readonly string[] | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setFactsError(undefined)
      if (props.readFacts !== undefined) setFacts(await props.readFacts())
      if (props.listTools !== undefined) setTools(await props.listTools())
    } catch (error) {
      setFactsError(error instanceof Error ? error.message : String(error))
    }
  }, [props.readFacts, props.listTools])

  useEffect(() => { void refresh() }, [refresh])
  const platform = bridge()?.getPlatform?.() ?? 'unknown'

  useEffect(() => {
    void bridge()?.getAppVersion?.().then(setAppVersion).catch(() => undefined)
  }, [])

  const toggle = (next: boolean): void => {
    setShowTokens(next)
    try { window.localStorage.setItem(SHOW_TOKENS_KEY, next ? '1' : '0') } catch { /* 私密模式等：降级为仅本页生效 */ }
  }

  return (
    <div style={S.page} data-settings-page="region-replacement">
      <div style={S.card}>
        <h3 style={S.h}>本会话资源（corumSessionFacts/snapshot）</h3>
        {factsError !== undefined && <p style={S.p}>读取失败：{factsError}</p>}
        <div style={S.row}><span style={S.mono}>会话</span><span>{facts?.sessionId !== undefined && facts.sessionId !== '' ? facts.sessionId : '—'}</span></div>
        <div style={S.row}><span style={S.mono}>轮次 / 步</span><span>{facts?.stats === undefined ? '—' : `${facts.stats.turns} / ${facts.stats.steps}`}</span></div>
        <div style={S.row}><span style={S.mono}>tokens</span><span>{facts?.tokens === undefined ? '—' : `输入 ${facts.tokens.uncachedInputTokens} · 输出 ${facts.tokens.outputTokens} · 缓存读 ${facts.tokens.cacheReadTokens}`}</span></div>
        <div style={S.row}><span style={S.mono}>上下文占用</span><span>{facts?.context?.usedRatio === undefined ? '—' : `${Math.round(facts.context.usedRatio * 100)}%${facts.context.contextWindow === undefined ? '' : `（${facts.context.pressureTokens ?? '?'} / ${facts.context.contextWindow}）`}`}</span></div>
        <div style={S.row}><span style={S.mono}>子 Agent</span><span>{facts === undefined ? '—' : `${facts.subagents.length} 个`}</span></div>
        {facts?.warnings !== undefined && <p style={S.hint}>降级说明：{facts.warnings.join('；')}</p>}
        <button type="button" onClick={() => { void refresh() }} style={{ ...S.mono, alignSelf: 'flex-start', padding: '3px 10px', borderRadius: '8px', border: '1px solid var(--corum-glass-border)', background: 'var(--corum-glass-2)', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' }}>刷新</button>
      </div>

      <div style={S.card}>
        <h3 style={S.h}>Agent 工具面（本插件注入了 demo_session_report）</h3>
        <p style={S.p}>{tools === undefined ? '读取中…' : `共 ${tools.length} 条：${tools.slice(0, 8).join(' / ')}${tools.length > 8 ? ' …' : ''}`}</p>
        <p style={S.hint}>本插件自己注册的工具：{tools?.includes('demo_session_report') === true ? '✓ demo_session_report 在清单里' : '（尚未出现，宿主工具面可能有延迟）'}</p>
      </div>

      <div style={S.card}>
        <h3 style={S.h}>测试插件 · 区域替换</h3>
        <p style={S.p}>
          本插件只在契约允许的两处出现：<strong>右侧区域覆盖</strong>（编辑器 / 终端）与
          <strong>这里</strong>（设置 › 扩展）。它不改壳布局、不新增网格区域、不碰内部层包。
        </p>
        <div style={S.row}><span style={S.mono}>平台</span><span>{platform}</span></div>
        <div style={S.row}><span style={S.mono}>应用版本</span><span>{appVersion ?? '—'}</span></div>
      </div>

      <div style={S.card}>
        <label style={S.row}>
          <input type="checkbox" checked={showTokens} onChange={event => { toggle(event.target.checked) }} />
          <span>在「编辑器」面板里显示主题 token 取样</span>
        </label>
        <p style={S.hint}>
          这个开关写在 <code style={S.mono}>localStorage['{SHOW_TOKENS_KEY}']</code>，
          编辑器区域的覆盖面板读取它 —— 演示「设置页写、区域面板读」的跨区域链路。
        </p>
      </div>
    </div>
  )
}
