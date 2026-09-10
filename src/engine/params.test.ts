import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARAMS,
  iirCoefficient,
  levelAlphas,
  levelSize,
  maxLevels,
  motionAlphaForLevel,
  paramsFromQuery,
  paramsToQuery,
  processingSize,
  sanitize,
} from './params'

describe('iirCoefficient', () => {
  it('is 0 for degenerate input', () => {
    expect(iirCoefficient(1, 0)).toBe(0)
    expect(iirCoefficient(0, 0.033)).toBe(0)
  })
  it('retains more state for lower cutoffs and shorter frames', () => {
    const dt = 1 / 30
    expect(iirCoefficient(0.5, dt)).toBeGreaterThan(iirCoefficient(3, dt))
    expect(iirCoefficient(1, 1 / 60)).toBeGreaterThan(iirCoefficient(1, 1 / 30))
  })
  it('gives the same effective response after two half-steps as one full step', () => {
    const one = iirCoefficient(1.3, 0.05)
    const half = iirCoefficient(1.3, 0.025)
    expect(half * half).toBeCloseTo(one, 10)
  })
})

describe('pyramid geometry', () => {
  it('scales processing size by height keeping aspect', () => {
    expect(processingSize(1280, 720, 360)).toEqual({ w: 640, h: 360 })
    expect(processingSize(640, 480, 720)).toEqual({ w: 640, h: 480 })
  })
  it('halves level sizes with ceil', () => {
    expect(levelSize(641, 361, 1)).toEqual({ w: 321, h: 181 })
    expect(levelSize(640, 360, 3)).toEqual({ w: 80, h: 45 })
  })
  it('limits levels so the coarsest stays usable', () => {
    expect(maxLevels(640, 360)).toBe(6)
    expect(maxLevels(120, 90)).toBe(4)
  })
})

describe('motionAlphaForLevel', () => {
  const w = 640
  const h = 360
  it('zeroes the finest and coarsest levels', () => {
    expect(motionAlphaForLevel(20, 16, w, h, 0, 5)).toBe(0)
    expect(motionAlphaForLevel(20, 16, w, h, 4, 5)).toBe(0)
  })
  it('never exceeds α and attenuates finer levels', () => {
    const a = [1, 2, 3].map((i) => motionAlphaForLevel(20, 200, w, h, i, 5))
    for (const v of a) expect(v).toBeLessThanOrEqual(20)
    expect(a[0]).toBeLessThanOrEqual(a[1])
    expect(a[1]).toBeLessThanOrEqual(a[2])
  })
  it('uses full α when the level wavelength is above λ_c', () => {
    expect(motionAlphaForLevel(20, 4, w, h, 2, 5)).toBe(20)
  })
})

describe('levelAlphas', () => {
  it('amplifies only the coarsest level in colour mode', () => {
    const a = levelAlphas({ ...DEFAULT_PARAMS, mode: 'color', alpha: 50, levels: 4 }, 640, 360)
    expect(a).toEqual([0, 0, 0, 50])
  })
})

describe('sanitize', () => {
  it('keeps the band ordered with a minimum gap', () => {
    const p = sanitize({ ...DEFAULT_PARAMS, fLow: 2, fHigh: 1 })
    expect(p.fHigh).toBeGreaterThan(p.fLow)
  })
  it('clamps out of range values', () => {
    const p = sanitize({ ...DEFAULT_PARAMS, alpha: 9999, levels: 99, blend: -1 })
    expect(p.alpha).toBe(200)
    expect(p.levels).toBe(6)
    expect(p.blend).toBe(0)
  })
})

describe('URL round trip', () => {
  it('omits defaults and restores non-defaults', () => {
    expect(paramsToQuery(DEFAULT_PARAMS)).toBe('')
    const p = sanitize({ ...DEFAULT_PARAMS, mode: 'motion', alpha: 12.5, isolate: true, procHeight: 480 })
    expect(paramsFromQuery(paramsToQuery(p))).toEqual(p)
  })
  it('ignores garbage', () => {
    expect(paramsFromQuery('a=abc&m=weird&r=999')).toEqual(DEFAULT_PARAMS)
  })
})
