/**
 * download-manager 纯函数守卫（mock fetch + 临时目录，不触真实网络）。
 *
 * @module corum-update-checker/tests/download-manager
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadAsset, findExistingDownload } from '../src/download-manager.ts'

/** 造一个 fake ReadableStream（模拟 fetch body）。 */
function makeBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

/** 造一个 fake fetch，返回给定 chunks + content-length。 */
function fakeFetch(chunks: Uint8Array[], totalBytes: number, status = 200): typeof fetch {
  return (() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string): string | null => name === 'content-length' ? String(totalBytes) : null },
      body: makeBody(chunks),
    } as unknown as Response)) as typeof fetch
}

describe('downloadAsset', () => {
  let tmpDir: string
  afterEach(() => {
    if (tmpDir !== undefined) {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* noop */ }
    }
  })

  it('streams chunks to a .part file then atomically renames', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corum-dl-'))
    const chunks = [new TextEncoder().encode('hello '), new TextEncoder().encode('world')]
    const progresses: number[] = []
    const result = await downloadAsset(
      'https://ex/Corum-0.5.0-arm64-mac.zip',
      tmpDir, 'Corum-0.5.0-arm64-mac.zip',
      (p) => progresses.push(p.percent),
      fakeFetch(chunks, 11),
    )
    expect(result.filename).toBe('Corum-0.5.0-arm64-mac.zip')
    expect(result.size).toBe(11)
    expect(existsSync(join(tmpDir, 'Corum-0.5.0-arm64-mac.zip'))).toBe(true)
    expect(readFileSync(join(tmpDir, 'Corum-0.5.0-arm64-mac.zip'), 'utf8')).toBe('hello world')
    // .part 已被 rename 掉。
    expect(existsSync(join(tmpDir, 'Corum-0.5.0-arm64-mac.zip.part'))).toBe(false)
    // 进度回调被触发，且最终 >= 最后一次。
    expect(progresses.length).toBeGreaterThan(0)
    expect(progresses[progresses.length - 1]).toBeCloseTo(100, 1)
  })

  it('creates dest dir if missing', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corum-dl-'))
    const nested = join(tmpDir, 'sub', 'dir')
    const result = await downloadAsset(
      'https://ex/file.zip', nested, 'file.zip',
      undefined, fakeFetch([new TextEncoder().encode('x')], 1),
    )
    expect(existsSync(result.path)).toBe(true)
  })

  it('cleans up .part on HTTP error', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corum-dl-'))
    await expect(downloadAsset(
      'https://ex/404.zip', tmpDir, '404.zip',
      undefined, fakeFetch([], 0, 404),
    )).rejects.toThrow('HTTP 404')
    expect(existsSync(join(tmpDir, '404.zip'))).toBe(false)
    expect(existsSync(join(tmpDir, '404.zip.part'))).toBe(false)
  })

  it('cleans up .part on stream error', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corum-dl-'))
    // 一个会抛的 stream。
    const errorStream = new ReadableStream({
      start(controller) { controller.error(new Error('stream broke')) },
    })
    const errFetch = (() =>
      Promise.resolve({ ok: true, status: 200, headers: { get: () => '1' }, body: errorStream } as unknown as Response)) as typeof fetch
    await expect(downloadAsset(
      'https://ex/broken.zip', tmpDir, 'broken.zip', undefined, errFetch,
    )).rejects.toThrow('stream broke')
    expect(existsSync(join(tmpDir, 'broken.zip'))).toBe(false)
    expect(existsSync(join(tmpDir, 'broken.zip.part'))).toBe(false)
  })
})

describe('findExistingDownload', () => {
  let tmpDir: string
  afterEach(() => {
    if (tmpDir !== undefined) {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* noop */ }
    }
  })

  it('returns the file when it exists with matching size', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corum-dl-'))
    const p = join(tmpDir, 'Corum-0.5.0.zip')
    writeFileSync(p, Buffer.from('abc'))
    const found = findExistingDownload(tmpDir, 'Corum-0.5.0.zip', 3)
    expect(found).not.toBeNull()
    expect(found!.path).toBe(p)
    expect(found!.size).toBe(3)
  })

  it('returns null when size does not match', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corum-dl-'))
    writeFileSync(join(tmpDir, 'Corum-0.5.0.zip'), Buffer.from('abc'))
    expect(findExistingDownload(tmpDir, 'Corum-0.5.0.zip', 999)).toBeNull()
  })

  it('skips size check when expectedSize <= 0', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corum-dl-'))
    writeFileSync(join(tmpDir, 'Corum-0.5.0.zip'), Buffer.from('abc'))
    const found = findExistingDownload(tmpDir, 'Corum-0.5.0.zip', 0)
    expect(found).not.toBeNull()
    expect(found!.size).toBe(3)
  })

  it('returns null when file does not exist', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'corum-dl-'))
    expect(findExistingDownload(tmpDir, 'missing.zip', 0)).toBeNull()
  })
})
