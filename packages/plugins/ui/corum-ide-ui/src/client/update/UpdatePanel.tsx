/**
 * UpdatePanel —— 更新结果面板（四态，品牌头图 + 状态卡片）。
 *
 * 从活动栏用户菜单「检查更新」触发后弹出。展示更新流程的当前状态：
 *   ① 有更新·待下载（自动开始下载）
 *   ② 下载中（进度条）
 *   ③ 下载完成·重启安装
 *   ④ 已是最新
 *   + 检查失败 / 下载失败 降级态。
 *
 * 轮询策略：面板打开时每 800ms 拉一次 getState（downloading 态）或
 * 3s（非下载态）。关闭时停止。安装动作走 IPC（window.corumDesktop.installUpdate）。
 *
 * @module corum-ide-ui/client/update/UpdatePanel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, ExternalLink, RotateCw, RefreshCw, CircleCheck, CircleAlert, Info, X } from 'lucide-react'
import type { UpdateApi, UpdateState } from './update-api.ts'
import css from './UpdatePanel.module.css'

interface UpdatePanelProps {
  readonly api: UpdateApi
  readonly onClose: () => void
  /** 品牌头图 URL（corumapp://app/assets/...）。 */
  readonly heroImageSrc: string
}

const POLL_FAST_MS = 800
const POLL_SLOW_MS = 3000

export function UpdatePanel({ api, onClose, heroImageSrc }: UpdatePanelProps) {
  const [state, setState] = useState<UpdateState | null>(null)
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    const s = await api.getState()
    setState(s)
  }, [api])

  useEffect(() => {
    void poll()
    const interval = state?.phase === 'downloading' ? POLL_FAST_MS : POLL_SLOW_MS
    timerRef.current = setInterval(() => { void poll() }, interval)
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current)
    }
  }, [poll, state?.phase])

  const handleRecheck = useCallback(async () => {
    setBusy(true)
    try { await api.check() ; await poll() } finally { setBusy(false) }
  }, [api, poll])

  const handleDownload = useCallback(async () => {
    setBusy(true)
    try { await api.download() ; await poll() } finally { setBusy(false) }
  }, [api, poll])

  const handleInstall = useCallback(async () => {
    if (state?.downloadedFile === null || state?.downloadedFile === undefined) return
    const bridge = (window as unknown as { corumDesktop?: { installUpdate?: (p: string) => Promise<{ ok: boolean; error?: string }> } }).corumDesktop
    if (bridge?.installUpdate === undefined) return
    await bridge.installUpdate(state.downloadedFile.path)
  }, [state])

  if (state === null) {
    return createPortal(
      <div className={css.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div className={css.panel}>
          <div className={css.hero} style={{ backgroundImage: `url(${heroImageSrc})` }} />
          <div className={css.body}>
            <p className={css.title}>正在检查更新…</p>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  const phase = state.phase
  const isReady = phase === 'downloaded-ready'

  return createPortal(
    <div className={css.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`${css.panel} ${isReady ? css.panelReady : ''}`}>
        <div className={css.hero} style={{ backgroundImage: `url(${heroImageSrc})` }}>
          <button type="button" className={css.closeBtn} onClick={onClose} aria-label="关闭">
            <X size={11} />
          </button>
        {phase === 'update-available' && <span className={`${css.chip} ${css.chipNew}`}>v{state.latestVersion} 可用</span>}
        {phase === 'downloading' && state.downloadProgress !== null && (
          <span className={`${css.chip} ${css.chipDl}`}>下载中 {Math.round(state.downloadProgress.percent)}%</span>
        )}
        {isReady && <span className={`${css.chip} ${css.chipDone}`}>下载完成</span>}
        {phase === 'up-to-date' && <span className={`${css.chip} ${css.chipOk}`}>v{state.currentVersion}</span>}
        {(phase === 'check-failed' || phase === 'download-failed') && (
          <span className={`${css.chip} ${css.chipFail}`}>{phase === 'check-failed' ? '检查失败' : '下载失败'}</span>
        )}
      </div>
      <div className={css.body}>
        {phase === 'update-available' && (
          <>
            <p className={css.title}>发现新版本</p>
            <p className={css.verLine}>
              当前 v{state.currentVersion} → 最新 v{state.latestVersion}
              {state.downloadAsset !== null && ` · ${platformLabel(state.downloadAsset.platform)} · ${formatSize(state.downloadAsset.size)}`}
            </p>
            {state.releaseNotes !== null && (
              <>
                <p className={css.notesLabel}>更新日志</p>
                <p className={css.notes}>{state.releaseNotes}</p>
              </>
            )}
            <div className={css.actions}>
              <button type="button" className={`${css.btn} ${css.btnSecondary}`} onClick={onClose}>稍后</button>
              <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={handleDownload}>
                <Download size={12} /> 立即下载
              </button>
            </div>
          </>
        )}

        {phase === 'downloading' && state.downloadProgress !== null && (
          <>
            <p className={css.title}>正在后台下载更新</p>
            <div className={css.track}>
              <div className={css.fill} style={{ width: `${state.downloadProgress.percent}%` }} />
            </div>
            <div className={css.dlBox}>
              <div className={css.dlDetail}>
                <span>{state.downloadAsset?.filename ?? ''}</span>
                <span>{formatBytes(state.downloadProgress.receivedBytes)} / {formatBytes(state.downloadProgress.totalBytes)}</span>
              </div>
            </div>
            <p className={css.hint}>后台下载，不影响使用。下载完成后活动栏会亮起提醒。</p>
            <div className={css.actions}>
              <button type="button" className={`${css.btn} ${css.btnSecondary}`} onClick={onClose}>隐藏</button>
            </div>
          </>
        )}

        {isReady && (
          <>
            <p className={css.title}>更新已就绪</p>
            <p className={css.verLine}>v{state.latestVersion} 已下载完成{state.downloadedFile !== null ? `（${formatSize(state.downloadedFile.size)}）` : ''}</p>
            <div className={css.restartNote}>
              <Info size={13} className={css.okIcon} style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
              <span className={css.restartNoteText}>重启应用后自动完成安装，当前会话进度不会丢失。</span>
            </div>
            <div className={css.actions}>
              <button type="button" className={`${css.btn} ${css.btnSecondary}`} onClick={onClose}>稍后重启</button>
              <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={handleInstall}>
                <RotateCw size={12} /> 重启安装
              </button>
            </div>
          </>
        )}

        {phase === 'up-to-date' && (
          <>
            <div className={css.okRow}>
              <CircleCheck size={18} className={css.okIcon} />
              <p className={css.title}>已是最新版本</p>
            </div>
            <p className={css.verLine}>你正在使用最新版本 v{state.currentVersion}。</p>
            {state.checkedAt !== null && (
              <div className={css.timeRow}>
                <span className={css.timeText}>上次检查：{formatTime(state.checkedAt)}</span>
                <button type="button" className={css.btnRecheck} onClick={handleRecheck} disabled={busy}>
                  <RefreshCw size={11} className={busy ? css.spinner : ''} /> 重新检查
                </button>
              </div>
            )}
          </>
        )}

        {(phase === 'check-failed' || phase === 'download-failed') && (
          <>
            <div className={css.okRow}>
              <CircleAlert size={18} style={{ color: 'var(--dsw-alias-state-warn-primary, #ff9f0a)' }} />
              <p className={css.title}>{phase === 'check-failed' ? '检查失败' : '下载失败'}</p>
            </div>
            {state.error !== null && <p className={css.notes}>{state.error}</p>}
            {phase === 'check-failed' && <p className={css.hint}>可能是网络连接问题或 GitHub API 限流，请稍后重试。</p>}
            <div className={css.actions}>
              {phase === 'download-failed' ? (
                <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={handleDownload}>
                  <Download size={12} /> 重试下载
                </button>
              ) : (
                <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={handleRecheck} disabled={busy}>
                  <RefreshCw size={12} className={busy ? css.spinner : ''} /> 重试
                </button>
              )}
              {state.releaseUrl !== null && (
                <a href={state.releaseUrl} target="_blank" rel="noreferrer" className={`${css.btn} ${css.btnSecondary}`}>
                  <ExternalLink size={12} /> 前往
                </a>
              )}
            </div>
          </>
        )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function platformLabel(platform: string): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  return sameDay ? `今天 ${time}` : `${d.getMonth() + 1}/${d.getDate()} ${time}`
}
