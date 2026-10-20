/**
 * 「编辑器」区域的替换实现（测试插件）。
 *
 * 演示三件事，都用 `@corum/plugin-sdk` 的公开面完成：
 * ① `RegionCard` 作为区域卡壳（圆角/玻璃底/描边全走主题 token）；
 * ② `window.corumDesktop.getPlatform()` + 主题 token 取样（证明跨 bundle 读取桥与 CSS 变量都可用）；
 * ③ 经 SDK 的 `makeCorumRpcCall` 调宿主 `pluginManager/list`（证明客户端半能真调 host RPC）。
 *
 * @module @corum-examples/region-replacement/client/EditorReplacement
 */

import { useEffect, useMemo, useState } from 'react'
import { RegionCard } from '@corum/plugin-sdk/client'
import type { CorumRpcCall } from '@corum/plugin-sdk/client'

/** 桌面桥的窄化面（缺失时静默降级：Web 版没有它）。 */
interface DesktopBridge {
  getPlatform?: () => string
  getAppVersion?: () => Promise<string>
}

function bridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { corumDesktop?: DesktopBridge }).corumDesktop
}

/** 宿主 `pluginManager/list` 的最小投影。 */
interface PluginListShape {
  entries: ReadonlyArray<{ moduleName?: string; kind?: string; enabled?: boolean }>
  dshVersion?: string
}

export interface EditorReplacementProps {
  /** SDK 的 RPC caller（由 apply 注入；缺失时面板显示「未接 RPC」）。 */
  callRemote?: CorumRpcCall | undefined
}

const S = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px 16px',
    height: '100%',
    minHeight: 0,
    overflow: 'auto',
    font: '13px/1.7 Inter, -apple-system, "PingFang SC", sans-serif',
    color: 'var(--dsw-alias-label-primary)',
  },
  head: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
  badge: {
    padding: '1px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    color: 'var(--dsw-alias-label-secondary)',
    background: 'var(--corum-glass-2)',
    border: '1px solid var(--corum-glass-border)',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px' },
  cell: {
    padding: '8px 10px',
    borderRadius: '10px',
    background: 'var(--corum-glass-1)',
    border: '1px solid var(--corum-glass-border)',
  },
  label: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
  value: { fontSize: '12.5px', color: 'var(--dsw-alias-label-primary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  swatches: { display: 'flex', gap: '6px', marginTop: '4px' },
  swatch: { width: '18px', height: '18px', borderRadius: '5px', border: '1px solid var(--corum-glass-border)' },
  note: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' },
} as const

/**
 * 编辑器区域的替换面板。
 * @param props - apply 注入的 RPC caller。
 * @returns 区域内容。
 */
export function EditorReplacement({ callRemote }: EditorReplacementProps): React.JSX.Element {
  const [pluginCount, setPluginCount] = useState<number | undefined>(undefined)
  const [dshVersion, setDshVersion] = useState<string | undefined>(undefined)
  const [rpcError, setRpcError] = useState<string | undefined>(undefined)
  const [appVersion, setAppVersion] = useState<string | undefined>(undefined)

  const platform = useMemo(() => bridge()?.getPlatform?.() ?? 'unknown', [])
  // 设置页（设置 › 扩展）写这个键；本面板读它 —— 演示「设置页写、区域面板读」的链路。
  const showTokens = useMemo(() => {
    try { return window.localStorage.getItem('region-replacement.showThemeTokens') !== '0' } catch { return true }
  }, [])

  useEffect(() => {
    void bridge()?.getAppVersion?.().then(setAppVersion).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (callRemote === undefined) return
    let cancelled = false
    void callRemote<PluginListShape>('pluginManager', 'list', {})
      .then((snapshot) => {
        if (cancelled) return
        setPluginCount(snapshot.entries.filter(e => e.kind === 'plugin').length)
        setDshVersion(snapshot.dshVersion)
      })
      .catch((error: unknown) => { if (!cancelled) setRpcError(String(error)) })
    return () => { cancelled = true }
  }, [callRemote])

  return (
    <RegionCard slotKey="corum.editor">
      <div style={S.body} data-replacement="editor">
        <div style={S.head}>
          <strong>测试插件 · 已接管「编辑器」区域</strong>
          <span style={S.badge}>corum.editor</span>
          <span style={S.badge}>priority -1（遮蔽宿主 0）</span>
        </div>

        <div style={S.grid}>
          <div style={S.cell}>
            <div style={S.label}>平台（corum-platform 桥）</div>
            <div style={S.value}>{platform}</div>
          </div>
          <div style={S.cell}>
            <div style={S.label}>应用版本 / 基座版本</div>
            <div style={S.value}>{appVersion ?? '—'} / {dshVersion ?? '—'}</div>
          </div>
          <div style={S.cell}>
            <div style={S.label}>已装功能插件数（宿主 RPC）</div>
            <div style={S.value}>{pluginCount ?? (rpcError === undefined ? '查询中…' : `失败：${rpcError}`)}</div>
          </div>
          {showTokens && <div style={S.cell}>
            <div style={S.label}>主题 token 取样</div>
            <div style={S.swatches}>
              <span style={{ ...S.swatch, background: 'var(--corum-glass-1)' }} title="--corum-glass-1" />
              <span style={{ ...S.swatch, background: 'var(--corum-glass-2)' }} title="--corum-glass-2" />
              <span style={{ ...S.swatch, background: 'var(--dsw-alias-label-primary)' }} title="--dsw-alias-label-primary" />
              <span style={{ ...S.swatch, background: 'var(--corum-glass-border)' }} title="--corum-glass-border" />
            </div>
          </div>}
        </div>

        <p style={S.note}>
          本区域原 occupant 是 desktom 的 Monaco 编辑器（`packages/desktop/src/client/editor`）。
          本插件没有改它一个字节 —— 只是在 `corum.editor` 上以更低 priority 注册了自己的
          occupant；卸载本插件后原编辑器自动回来。
        </p>
      </div>
    </RegionCard>
  )
}
