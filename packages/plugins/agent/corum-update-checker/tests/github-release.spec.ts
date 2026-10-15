/**
 * github-release 纯函数守卫。
 *
 * ## 覆盖面
 *
 * 1. fetchLatestRelease：成功 / HTTP 404 / HTTP 403 限流 / 超时 / 网络错误
 *    （注入 mock fetch，不触真实网络）。
 * 2. parseLatestRelease：成功解析 / 形状缺失（无 tag_name）/ 资产匹配。
 * 3. isUpdateAvailable：latest > current / 相等 / 更小 / 解析失败。
 *
 * @module corum-update-checker/tests/github-release
 */
import { describe, expect, it, vi } from 'vitest'
import {
  fetchLatestRelease, parseLatestRelease, isUpdateAvailable,
  type GithubReleaseConfig,
} from '../src/github-release.ts'

/** 构造一份 GitHub releases/latest 成功响应的 JSON。 */
function latestReleaseJson(tag = 'v0.5.0'): unknown {
  return {
    tag_name: tag,
    name: tag,
    html_url: 'https://github.com/kukucaiCndy/Corum-Harness/releases/tag/v0.5.0',
    body: '## 更新日志\n- 修复了 X\n- 新增了 Y',
    prerelease: false,
    published_at: '2026-10-20T00:00:00Z',
    assets: [
      { name: `Corum-0.5.0-arm64-mac.zip`, browser_download_url: 'https://ex/zip', size: 100 },
      { name: `Corum-0.5.0-arm64.dmg`, browser_download_url: 'https://ex/dmg', size: 100 },
      { name: `Corum-0.5.0-win-x64.exe`, browser_download_url: 'https://ex/exe', size: 200 },
      { name: `Corum-0.5.0.AppImage`, browser_download_url: 'https://ex/appimage', size: 300 },
    ],
  }
}

/** 构造一个 fake Response（满足 fetchLatestRelease 的读取面）。 */
function fakeResponse(ok: boolean, status: number, json: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok,
    status,
    headers: {
      get: (name: string): string | null => headers[name.toLowerCase()] ?? null,
    },
    json: async () => json,
  } as unknown as Response
}

// ── fetchLatestRelease ──────────────────────────────────────────────

describe('fetchLatestRelease', () => {
  const baseConfig: GithubReleaseConfig = { owner: 'kukucaiCndy', repo: 'Corum-Harness' }

  it('returns ok with json on HTTP 200', async () => {
    const mockFetch = vi.fn(async () => fakeResponse(true, 200, latestReleaseJson()))
    const result = await fetchLatestRelease({ ...baseConfig, fetchImpl: mockFetch as never })
    expect(result.ok).toBe(true)
    expect(result.json).toBeDefined()
    expect((result.json as { tag_name: string }).tag_name).toBe('v0.5.0')
    // 验证请求 URL 与 headers
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/kukucaiCndy/Corum-Harness/releases/latest')
    const opts = init as { headers: Record<string, string> }
    expect(opts.headers['Accept']).toBe('application/vnd.github+json')
    expect(opts.headers['User-Agent']).toBe('corum-update-checker')
  })

  it('returns not-found error on HTTP 404', async () => {
    const mockFetch = vi.fn(async () => fakeResponse(false, 404, {}))
    const result = await fetchLatestRelease({ ...baseConfig, fetchImpl: mockFetch as never })
    expect(result.ok).toBe(false)
    expect(result.error!.kind).toBe('not-found')
    expect(result.error!.status).toBe(404)
  })

  it('returns rate-limited error on HTTP 403 + X-RateLimit-Remaining: 0', async () => {
    const mockFetch = vi.fn(async () =>
      fakeResponse(false, 403, {}, { 'x-ratelimit-remaining': '0' }))
    const result = await fetchLatestRelease({ ...baseConfig, fetchImpl: mockFetch as never })
    expect(result.ok).toBe(false)
    expect(result.error!.kind).toBe('rate-limited')
  })

  it('returns http-error on HTTP 500', async () => {
    const mockFetch = vi.fn(async () => fakeResponse(false, 500, {}))
    const result = await fetchLatestRelease({ ...baseConfig, fetchImpl: mockFetch as never })
    expect(result.ok).toBe(false)
    expect(result.error!.kind).toBe('http-error')
    expect(result.error!.status).toBe(500)
  })

  it('returns network-error on fetch throw', async () => {
    const mockFetch = vi.fn(async () => { throw new TypeError('fetch failed') })
    const result = await fetchLatestRelease({ ...baseConfig, fetchImpl: mockFetch as never })
    expect(result.ok).toBe(false)
    expect(result.error!.kind).toBe('network-error')
    expect(result.error!.message).toContain('fetch failed')
  })

  it('returns network-error when no fetch is available anywhere', async () => {
    // 模拟无全局 fetch 的环境：临时删除 globalThis.fetch，且不注入 fetchImpl。
    const originalFetch = globalThis.fetch
    // @ts-expect-error 临时删除全局 fetch（测试隔离）
    delete globalThis.fetch
    try {
      const result = await fetchLatestRelease({ ...baseConfig })
      expect(result.ok).toBe(false)
      expect(result.error!.kind).toBe('network-error')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

// ── parseLatestRelease ─────────────────────────────────────────────

describe('parseLatestRelease', () => {
  it('parses a valid release JSON with matching platform asset', () => {
    const parsed = parseLatestRelease(latestReleaseJson('v0.5.0'), 'darwin', 'arm64')
    expect(parsed).not.toBeNull()
    expect(parsed!.tag).toBe('v0.5.0')
    expect(parsed!.version).toBe('0.5.0')
    expect(parsed!.releaseUrl).toContain('releases/tag/v0.5.0')
    expect(parsed!.releaseNotes).toContain('更新日志')
    expect(parsed!.prerelease).toBe(false)
    expect(parsed!.publishedAt).toBe('2026-10-20T00:00:00Z')
    expect(parsed!.downloadAsset).not.toBeNull()
    expect(parsed!.downloadAsset!.filename).toBe('Corum-0.5.0-arm64-mac.zip')
    expect(parsed!.downloadAsset!.platform).toBe('darwin')
  })

  it('parses win32 asset', () => {
    const parsed = parseLatestRelease(latestReleaseJson('v0.5.0'), 'win32', 'x64')
    expect(parsed!.downloadAsset!.filename).toBe('Corum-0.5.0-win-x64.exe')
    expect(parsed!.downloadAsset!.platform).toBe('win32')
  })

  it('parses linux asset', () => {
    const parsed = parseLatestRelease(latestReleaseJson('v0.5.0'), 'linux', 'x64')
    expect(parsed!.downloadAsset!.filename).toBe('Corum-0.5.0.AppImage')
    expect(parsed!.downloadAsset!.platform).toBe('linux')
  })

  it('returns null when tag_name is missing', () => {
    expect(parseLatestRelease({}, 'darwin', 'arm64')).toBeNull()
    expect(parseLatestRelease({ tag_name: 123 }, 'darwin', 'arm64')).toBeNull()
  })

  it('returns null asset when platform has no matching build', () => {
    const parsed = parseLatestRelease(latestReleaseJson('v0.5.0'), 'darwin', 'x64')
    expect(parsed).not.toBeNull()
    expect(parsed!.downloadAsset).toBeNull()
  })

  it('handles missing body / published_at gracefully', () => {
    const json = { tag_name: 'v0.5.0', html_url: 'https://ex' }
    const parsed = parseLatestRelease(json, 'darwin', 'arm64')
    expect(parsed!.releaseNotes).toBeNull()
    expect(parsed!.publishedAt).toBeNull()
    expect(parsed!.prerelease).toBe(false) // 缺失默认 false
  })
})

// ── isUpdateAvailable ──────────────────────────────────────────────

describe('isUpdateAvailable', () => {
  it('returns true when latest > current', () => {
    expect(isUpdateAvailable('0.4.0', '0.5.0')).toBe(true)
    expect(isUpdateAvailable('0.4.0', '0.4.1')).toBe(true)
    expect(isUpdateAvailable('0.4.0', '1.0.0')).toBe(true)
  })

  it('returns false when latest === current', () => {
    expect(isUpdateAvailable('0.4.0', '0.4.0')).toBe(false)
    expect(isUpdateAvailable('v0.4.0', '0.4.0')).toBe(false)
  })

  it('returns false when latest < current', () => {
    expect(isUpdateAvailable('0.5.0', '0.4.0')).toBe(false)
  })

  it('respects prerelease semantics', () => {
    // 0.5.0-rc.1 < 0.5.0 → latest 是 rc，current 是正式版 → 无更新
    expect(isUpdateAvailable('0.5.0', '0.5.0-rc.1')).toBe(false)
    // 0.4.0 → 0.5.0-rc.1：rc 是否 > 0.4.0？0.5.0-rc.1 > 0.4.0（主版本更高）→ 有更新
    expect(isUpdateAvailable('0.4.0', '0.5.0-rc.1')).toBe(true)
  })

  it('returns false when either version is unparseable', () => {
    expect(isUpdateAvailable('invalid', '0.5.0')).toBe(false)
    expect(isUpdateAvailable('0.4.0', 'invalid')).toBe(false)
  })
})
