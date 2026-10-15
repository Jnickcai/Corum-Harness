/**
 * 下载管理器（纯函数 + Node fetch 流式下载，三平台纪律）。
 *
 * ## 职责
 *
 * 把一个 release 资产流式下载到本地缓存目录，**落盘后原子改名**（避免半包文件
 * 被当成完整产物）。进度回调驱动渲染层进度条（卡② 下载中）。
 *
 * ## 三平台
 *
 * - 下载本身平台无关（Node fetch + fs.createWriteStream）；
 * - 临时文件后缀 `.part`（三平台一致，不依赖平台临时目录约定）；
 * - 目标文件名直接用资产 filename（`Corum-0.5.0-arm64-mac.zip` 等，已含平台标识）。
 *
 * @module corum-update-checker/download-manager
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 下载进度事件。 */
export interface DownloadProgress {
  /** 已下载字节。 */
  readonly receivedBytes: number
  /** 总字节（Content-Length；未知为 0）。 */
  readonly totalBytes: number
  /** 进度百分比 0-100（totalBytes=0 时为 0）。 */
  readonly percent: number
}

/** 下载完成的产物信息。 */
export interface DownloadedFile {
  /** 落盘的完整路径。 */
  readonly path: string
  /** 文件名。 */
  readonly filename: string
  /** 大小（字节）。 */
  readonly size: number
}

/** 可注入的 fetch 实现（测试用 mock；缺省用全局 fetch）。 */
export type FetchImpl = typeof fetch

/**
 * 流式下载一个资产到目标目录。
 *
 * 流程：fetch → 读 Content-Length → createWriteStream 写 `.part` 临时文件 →
 * 流式 pipe 累计字节 → 完成后 rename 去掉 `.part`（原子落盘）。
 *
 * @param url - 资产 browser_download_url。
 * @param destDir - 目标目录（不存在则 mkdirSync 递归创建）。
 * @param filename - 目标文件名。
 * @param onProgress - 进度回调（每次 chunk 累计后调一次）。
 * @param fetchImpl - 可选 fetch 注入（测试用）。
 * @returns 落盘产物信息。
 * @throws 网络错误 / HTTP 非 2xx / 写盘错误。
 */
export async function downloadAsset(
  url: string,
  destDir: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
  fetchImpl?: FetchImpl,
): Promise<DownloadedFile> {
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof fetchFn !== 'function') {
    throw new Error('global fetch is not available')
  }
  // 确保目录存在（递归创建，三平台一致）。
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
  const finalPath = join(destDir, filename)
  const partPath = `${finalPath}.part`
  // 清理可能残留的 .part（上次中断的半包）。
  if (existsSync(partPath)) unlinkSync(partPath)

  const resp = await fetchFn(url)
  if (!resp.ok) {
    throw new Error(`download failed: HTTP ${resp.status}`)
  }
  if (resp.body === null) {
    throw new Error('download failed: response has no body')
  }
  const totalBytes = Number(resp.headers.get('content-length') ?? '0') || 0

  return await new Promise<DownloadedFile>((resolve, reject) => {
    const writer = createWriteStream(partPath)
    let receivedBytes = 0
    const reader = resp.body!.getReader()

    const cleanup = (): void => {
      try { writer.destroy() } catch { /* noop */ }
      try { reader.cancel().catch(() => {}) } catch { /* noop */ }
    }

    const pump = async (): Promise<void> => {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value !== undefined) {
            receivedBytes += value.length
            if (onProgress !== undefined) {
              onProgress({
                receivedBytes,
                totalBytes,
                percent: totalBytes > 0 ? Math.min(100, (receivedBytes / totalBytes) * 100) : 0,
              })
            }
            if (!writer.write(value)) {
              await new Promise<void>(res => writer.once('drain', res))
            }
          }
        }
        writer.end(() => {
          try {
            renameSync(partPath, finalPath)
            const size = statSync(finalPath).size
            resolve({ path: finalPath, filename, size })
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)))
          }
        })
      } catch (e) {
        cleanup()
        // 失败时清理 .part，不留半包。
        try { if (existsSync(partPath)) unlinkSync(partPath) } catch { /* noop */ }
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    void pump()

    writer.on('error', (err) => {
      cleanup()
      try { if (existsSync(partPath)) unlinkSync(partPath) } catch { /* noop */ }
      reject(err)
    })
  })
}

/**
 * 检查目标文件是否已存在且大小匹配（断点续传的简化判断：只看完整文件是否在）。
 *
 * @param destDir - 目录。
 * @param filename - 文件名。
 * @param expectedSize - 期望大小（>0 时校验，<=0 时跳过校验）。
 * @returns 已存在则返回路径与大小；否则 null。
 */
export function findExistingDownload(
  destDir: string,
  filename: string,
  expectedSize = 0,
): DownloadedFile | null {
  const path = join(destDir, filename)
  if (!existsSync(path)) return null
  try {
    const size = statSync(path).size
    if (expectedSize > 0 && size !== expectedSize) return null
    return { path, filename, size }
  } catch {
    return null
  }
}
