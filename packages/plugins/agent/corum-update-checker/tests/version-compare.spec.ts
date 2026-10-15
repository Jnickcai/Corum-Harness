/**
 * version-compare 纯函数守卫。
 *
 * ## 覆盖面
 *
 * 1. parseSemVer：标准 / v 前缀 / 预发布 / 非法输入。
 * 2. compareSemVer + gt/gte：主次修订号比较、预发布语义、多位数。
 * 3. compareVersionStrings：字符串包装。
 *
 * @module corum-update-checker/tests/version-compare
 */
import { describe, expect, it } from 'vitest'
import { parseSemVer, compareSemVer, gt, gte, compareVersionStrings } from '../src/version-compare.ts'

describe('parseSemVer', () => {
  it('parses standard MAJOR.MINOR.PATCH', () => {
    expect(parseSemVer('0.4.0')).toEqual({ major: 0, minor: 4, patch: 0, prerelease: [] })
    expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('strips v/V prefix (GitHub tag convention)', () => {
    expect(parseSemVer('v0.4.0')).toEqual({ major: 0, minor: 4, patch: 0, prerelease: [] })
    expect(parseSemVer('V1.0.0')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: [] })
  })

  it('parses prerelease suffix', () => {
    expect(parseSemVer('0.4.0-rc.1')).toEqual({
      major: 0, minor: 4, patch: 0, prerelease: ['rc', 1],
    })
    expect(parseSemVer('0.4.0-beta')).toEqual({
      major: 0, minor: 4, patch: 0, prerelease: ['beta'],
    })
    expect(parseSemVer('v0.4.0-alpha.3')).toEqual({
      major: 0, minor: 4, patch: 0, prerelease: ['alpha', 3],
    })
  })

  it('returns null for invalid inputs', () => {
    expect(parseSemVer('')).toBeNull()
    expect(parseSemVer('not-a-version')).toBeNull()
    expect(parseSemVer('0.4')).toBeNull()        // 只两段
    expect(parseSemVer('0.4.0.1')).toBeNull()    // 四段（本实现只认三段）
    expect(parseSemVer('a.b.c')).toBeNull()       // 非数字
    expect(parseSemVer('-1.0.0')).toBeNull()     // 负数
    expect(parseSemVer('0.4.x')).toBeNull()      // 含字母
  })
})

describe('compareSemVer', () => {
  it('compares major / minor / patch numerically', () => {
    expect(compareSemVer(parseSemVer('0.4.0')!, parseSemVer('0.5.0')!)).toBeLessThan(0)
    expect(compareSemVer(parseSemVer('0.10.0')!, parseSemVer('0.9.0')!)).toBeGreaterThan(0)
    expect(compareSemVer(parseSemVer('1.0.0')!, parseSemVer('0.9.9')!)).toBeGreaterThan(0)
    expect(compareSemVer(parseSemVer('0.4.0')!, parseSemVer('0.4.0')!)).toBe(0)
  })

  it('prerelease < release (same major.minor.patch)', () => {
    expect(compareSemVer(parseSemVer('0.4.0-rc.1')!, parseSemVer('0.4.0')!)).toBeLessThan(0)
    expect(compareSemVer(parseSemVer('0.4.0')!, parseSemVer('0.4.0-rc.1')!)).toBeGreaterThan(0)
  })

  it('compares prerelease identifiers per semver §11', () => {
    // 数字 < 字母
    expect(compareSemVer(parseSemVer('1.0.0-1')!, parseSemVer('1.0.0-alpha')!)).toBeLessThan(0)
    // 数字段按数值比较
    expect(compareSemVer(parseSemVer('1.0.0-rc.1')!, parseSemVer('1.0.0-rc.2')!)).toBeLessThan(0)
    // 字母段按 ASCII
    expect(compareSemVer(parseSemVer('1.0.0-alpha')!, parseSemVer('1.0.0-beta')!)).toBeLessThan(0)
    // 短的更小（`rc.1` < `rc.1.1`）
    expect(compareSemVer(parseSemVer('1.0.0-rc.1')!, parseSemVer('1.0.0-rc.1.1')!)).toBeLessThan(0)
  })
})

describe('gt / gte', () => {
  it('gt returns true only when strictly greater', () => {
    expect(gt(parseSemVer('0.5.0')!, parseSemVer('0.4.0')!)).toBe(true)
    expect(gt(parseSemVer('0.4.0')!, parseSemVer('0.4.0')!)).toBe(false)
    expect(gt(parseSemVer('0.3.0')!, parseSemVer('0.4.0')!)).toBe(false)
  })

  it('gte returns true when greater or equal', () => {
    expect(gte(parseSemVer('0.4.0')!, parseSemVer('0.4.0')!)).toBe(true)
    expect(gte(parseSemVer('0.5.0')!, parseSemVer('0.4.0')!)).toBe(true)
    expect(gte(parseSemVer('0.3.0')!, parseSemVer('0.4.0')!)).toBe(false)
  })
})

describe('compareVersionStrings', () => {
  it('compares raw version strings', () => {
    expect(compareVersionStrings('0.4.0', '0.5.0')).toBeLessThan(0)
    expect(compareVersionStrings('v0.4.0', '0.4.0')).toBe(0)
    expect(compareVersionStrings('0.5.0', '0.4.0')).toBeGreaterThan(0)
  })

  it('returns 0 when either fails to parse', () => {
    expect(compareVersionStrings('invalid', '0.4.0')).toBe(0)
    expect(compareVersionStrings('0.4.0', 'invalid')).toBe(0)
  })
})
