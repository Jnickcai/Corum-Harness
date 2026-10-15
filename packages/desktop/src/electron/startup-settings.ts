import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function settingsHome(): string {
  return process.env.CORUM_HOME?.trim() || join(homedir(), '.corum')
}

function readPreferences(home: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(join(home, 'desktop-settings.json'), 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('桌面设置格式无效')
    return value as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

/** 桌面壳提前读取；旧配置缺失字段时默认开启。 */
export function readStartupAnimationEnabled(home = settingsHome()): boolean {
  try {
    return readPreferences(home).startupAnimationEnabled !== false
  } catch (error) {
    console.warn('[corum-startup] 无法读取启动设置，使用默认值', String(error))
    return true
  }
}

export function writeStartupAnimationEnabled(enabled: boolean, home = settingsHome()): void {
  writePreference('startupAnimationEnabled', enabled, home)
}

export function readStartupThemeId(home = settingsHome()): string {
  try {
    const id = readPreferences(home).startupThemeId
    return typeof id === 'string' ? id : 'corum-terminal'
  } catch { return 'corum-terminal' }
}

export function writeStartupThemeId(id: string, home = settingsHome()): void {
  writePreference('startupThemeId', id, home)
}

function writePreference(key: string, value: unknown, home: string): void {
  const preferences = readPreferences(home)
  mkdirSync(home, { recursive: true })
  const path = join(home, 'desktop-settings.json')
  writeFileSync(`${path}.tmp`, JSON.stringify({ ...preferences, [key]: value }, null, 2), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
}
