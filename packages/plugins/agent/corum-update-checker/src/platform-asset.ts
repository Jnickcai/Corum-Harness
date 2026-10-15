/**
 * 平台 → 资产名映射纯函数（三平台纪律，红线 7）。
 * @module corum-update-checker/platform-asset
 */

export type UpdatePlatform = 'darwin' | 'linux' | 'win32'
export type UpdateArch = 'arm64' | 'x64' | string

export interface DownloadAsset {
  readonly platform: UpdatePlatform
  readonly arch: string
  readonly filename: string
  readonly downloadUrl: string
  readonly size: number
}

function candidateFilenames(platform: UpdatePlatform, arch: UpdateArch, version: string): readonly string[] {
  switch (platform) {
    case 'darwin':
      if (arch !== 'arm64') return []
      return [`Corum-${version}-arm64-mac.zip`, `Corum-${version}-arm64.dmg`]
    case 'win32':
      if (arch !== 'x64') return []
      return [`Corum-${version}-win-x64.exe`, `Corum-${version}-win-x64.zip`]
    case 'linux':
      if (arch !== 'x64') return []
      return [`Corum-${version}.AppImage`, `corum-desktop_${version}_amd64.deb`]
    default:
      return []
  }
}

export interface ReleaseAsset {
  readonly name: string
  readonly browser_download_url: string
  readonly size: number
}

export function matchPlatformAsset(
  assets: readonly ReleaseAsset[],
  platform: UpdatePlatform,
  arch: UpdateArch,
  version: string,
): DownloadAsset | null {
  const candidates = candidateFilenames(platform, arch, version)
  for (const filename of candidates) {
    const hit = assets.find(a => a.name === filename)
    if (hit !== undefined) {
      return { platform, arch, filename: hit.name, downloadUrl: hit.browser_download_url, size: hit.size }
    }
  }
  return null
}
