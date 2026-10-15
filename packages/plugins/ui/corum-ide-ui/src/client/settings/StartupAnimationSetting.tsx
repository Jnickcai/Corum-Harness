import { useEffect, useState } from 'react'
import { SettingGroup } from './SettingGroup.tsx'
import { SettingRow } from './SettingRow.tsx'
import { Switch } from './Switch.tsx'
import css from './StartupAnimationSetting.module.css'

interface StartupThemeInfo {
  id: string; name: string; version: string; type: 'html' | 'video'; builtin: boolean
  author?: string; previewUrl?: string
}
interface StartupThemeCatalog { themes: StartupThemeInfo[]; selectedId: string }

interface StartupBridge {
  getStartupAnimationEnabled: () => Promise<boolean>
  setStartupAnimationEnabled: (enabled: boolean) => Promise<boolean>
  listStartupThemes: () => Promise<StartupThemeCatalog>
  importStartupTheme: () => Promise<{ cancelled: boolean }>
  selectStartupTheme: (id: string) => Promise<void>
  deleteStartupTheme: (id: string) => Promise<{ cancelled: boolean }>
  previewStartupTheme: (id: string) => Promise<void>
}

/** 桌面启动偏好由 Electron 壳持久化，网页模式不显示此设置。 */
export function StartupAnimationSetting() {
  const desktop = typeof window === 'undefined' ? undefined
    : (window as unknown as { corumDesktop?: Partial<StartupBridge> }).corumDesktop
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [catalog, setCatalog] = useState<StartupThemeCatalog | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    desktop?.getStartupAnimationEnabled?.().then(value => { if (active) setEnabled(value) })
      .catch(err => { if (active) setError(String(err)) })
    desktop?.listStartupThemes?.().then(value => { if (active) setCatalog(value) })
      .catch(err => { if (active) setError(String(err)) })
    return () => { active = false }
  }, [desktop])
  if (desktop?.getStartupAnimationEnabled === undefined || desktop.setStartupAnimationEnabled === undefined) return null

  const save = async (value: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const saved = await desktop.setStartupAnimationEnabled!(value)
      setEnabled(saved)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  const run = async (action: () => Promise<unknown>, refresh = true): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (refresh) setCatalog(await desktop.listStartupThemes!())
    } catch (err) { setError(String(err)) }
    finally { setBusy(false) }
  }
  return (
    <SettingGroup title="启动">
      <SettingRow label="启动动画" desc="启动时播放所选动画或视频。修改后自动保存，下次启动生效；关闭后仍显示必要的加载状态。">
        <Switch label="启动动画" checked={enabled === true} disabled={enabled === null || busy} onChange={value => { void save(value) }} />
      </SettingRow>
      {desktop.listStartupThemes && <>
        <SettingRow label="启动主题" desc="播放结束且主界面就绪后进入，随时可按 Esc 跳过。主题选择在下次启动生效。">
          <button className={css.button} disabled={busy || !catalog} onClick={() => { void run(() => desktop.importStartupTheme!()) }}>导入主题</button>
        </SettingRow>
        {catalog && <ul className={css.list} aria-label="已安装的启动主题">
          {catalog.themes.map(theme => <li className={css.theme} key={theme.id}>
            {theme.previewUrl && <img className={css.preview} src={theme.previewUrl} alt="" />}
            <div className={css.meta}>
              <strong>{theme.name}</strong>
              <span className={css.detail}>{theme.type === 'html' ? 'HTML 动画' : '视频'} · {theme.version}{theme.builtin ? ' · 内置' : ''}{theme.author ? ` · ${theme.author}` : ''}</span>
            </div>
            <div className={css.actions}>
              <button className={css.button} aria-label={`预览 ${theme.name}`} disabled={busy} onClick={() => { void run(() => desktop.previewStartupTheme!(theme.id), false) }}>预览</button>
              <button className={css.button} aria-label={`使用 ${theme.name}`} aria-pressed={catalog.selectedId === theme.id} disabled={busy || catalog.selectedId === theme.id} onClick={() => { void run(() => desktop.selectStartupTheme!(theme.id)) }}>{catalog.selectedId === theme.id ? '已使用' : '使用'}</button>
              {!theme.builtin && <button className={css.button} aria-label={`删除 ${theme.name}`} disabled={busy} onClick={() => { void run(() => desktop.deleteStartupTheme!(theme.id)) }}>删除</button>}
            </div>
          </li>)}
        </ul>}
      </>}
      {error !== null && <p role="alert">{error}</p>}
    </SettingGroup>
  )
}
