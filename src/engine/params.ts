/**
 * Engine parameters, presets, and the small pieces of filter math that are
 * worth unit-testing. No DOM or WebGL in this file.
 */

export type Mode = 'color' | 'motion'
export type ProcHeight = 240 | 360 | 480 | 720

export interface Params {
  mode: Mode
  /** Amplification factor α. */
  alpha: number
  /** Temporal band, Hz. */
  fLow: number
  fHigh: number
  /** Spatial wavelength cutoff λ_c in pixels (motion mode). */
  lambdaC: number
  /** Number of pyramid levels including level 0. */
  levels: number
  /** Multiplier applied to the I and Q chroma channels of the amplified signal. */
  chroma: number
  /** Processing resolution (height); width follows the camera aspect. */
  procHeight: ProcHeight
  /** 0 = original, 1 = fully magnified. */
  blend: number
  /** Show only the amplified band, on a grey background. */
  isolate: boolean
  /** Spatial pre-blur radius in pixels at processing resolution, 0-3. */
  denoise: number
}

export const LIMITS = {
  alpha: { min: 1, max: 200 },
  freq: { min: 0.05, max: 10 },
  minBandRatio: 1.25,
  lambdaC: { min: 4, max: 256 },
  levels: { min: 2, max: 6 },
  chroma: { min: 0, max: 1 },
  blend: { min: 0, max: 1 },
  denoise: { min: 0, max: 3 },
} as const

export const PROC_HEIGHTS: ProcHeight[] = [240, 360, 480, 720]

export const DEFAULT_PARAMS: Params = {
  mode: 'color',
  alpha: 30,
  fLow: 0.8,
  fHigh: 3,
  lambdaC: 64,
  levels: 4,
  chroma: 1,
  procHeight: 360,
  blend: 1,
  isolate: false,
  denoise: 0,
}

export interface Preset {
  id: string
  name: string
  hint: string
  params: Partial<Params>
}

export const PRESETS: Preset[] = [
  {
    id: 'pulse',
    name: 'Pulse',
    hint: 'Face or palm in steady light. Colour changes at 48–180 BPM.',
    params: { mode: 'color', alpha: 80, fLow: 0.8, fHigh: 3, levels: 4, chroma: 1, blend: 1, denoise: 1 },
  },
  {
    id: 'breathing',
    name: 'Breathing',
    hint: 'A seated person, chest and shoulders in frame.',
    params: { mode: 'motion', alpha: 15, fLow: 0.15, fHigh: 0.8, lambdaC: 64, levels: 5, chroma: 0.1, blend: 1, denoise: 0 },
  },
  {
    id: 'vibration',
    name: 'Vibration',
    hint: 'Machinery, speakers, strings. Hold the camera still.',
    params: { mode: 'motion', alpha: 20, fLow: 3, fHigh: 10, lambdaC: 16, levels: 4, chroma: 0.1, blend: 1, denoise: 0 },
  },
  {
    id: 'wrist',
    name: 'Wrist pulse',
    hint: 'Inside of the wrist, close up. Skin motion from the artery.',
    params: { mode: 'motion', alpha: 40, fLow: 0.8, fHigh: 3, lambdaC: 32, levels: 4, chroma: 0.1, blend: 1, denoise: 1 },
  },
]

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Clamp every field into its legal range and keep the band well-formed. */
export function sanitize(p: Params): Params {
  const out: Params = { ...p }
  out.alpha = clamp(out.alpha, LIMITS.alpha.min, LIMITS.alpha.max)
  out.fLow = clamp(out.fLow, LIMITS.freq.min, LIMITS.freq.max)
  out.fHigh = clamp(out.fHigh, LIMITS.freq.min, LIMITS.freq.max)
  if (out.fHigh < out.fLow * LIMITS.minBandRatio) {
    out.fHigh = Math.min(LIMITS.freq.max, out.fLow * LIMITS.minBandRatio)
    if (out.fHigh < out.fLow * LIMITS.minBandRatio) {
      out.fLow = out.fHigh / LIMITS.minBandRatio
    }
  }
  out.lambdaC = clamp(out.lambdaC, LIMITS.lambdaC.min, LIMITS.lambdaC.max)
  out.levels = Math.round(clamp(out.levels, LIMITS.levels.min, LIMITS.levels.max))
  out.chroma = clamp(out.chroma, LIMITS.chroma.min, LIMITS.chroma.max)
  out.blend = clamp(out.blend, LIMITS.blend.min, LIMITS.blend.max)
  out.denoise = Math.round(clamp(out.denoise, LIMITS.denoise.min, LIMITS.denoise.max))
  if (!PROC_HEIGHTS.includes(out.procHeight)) out.procHeight = DEFAULT_PARAMS.procHeight
  if (out.mode !== 'color' && out.mode !== 'motion') out.mode = DEFAULT_PARAMS.mode
  return out
}

/**
 * First-order IIR coefficient for a low-pass with cutoff f (Hz) and frame
 * interval dt (s):  y = mix(x, y, r).  Derived from the continuous-time RC
 * response so the cutoff stays correct when the frame rate varies.
 */
export function iirCoefficient(fCutoff: number, dt: number): number {
  if (!(dt > 0) || !(fCutoff > 0)) return 0
  return Math.exp(-2 * Math.PI * fCutoff * dt)
}

/** Processing width/height for a given camera frame and target height. */
export function processingSize(videoW: number, videoH: number, procHeight: number) {
  const h = Math.min(procHeight, videoH)
  const w = Math.max(1, Math.round((videoW * h) / videoH))
  return { w, h: Math.max(1, h) }
}

/** Max number of pyramid levels so the coarsest level stays at least 8 px wide/high. */
export function maxLevels(w: number, h: number): number {
  let n = 1
  while (Math.min(w, h) / 2 ** n >= 8 && n < LIMITS.levels.max) n++
  return Math.max(LIMITS.levels.min, n)
}

/** Size of pyramid level i. */
export function levelSize(w: number, h: number, i: number) {
  return { w: Math.max(1, Math.ceil(w / 2 ** i)), h: Math.max(1, Math.ceil(h / 2 ** i)) }
}

/**
 * Representative spatial wavelength at level i, following Wu et al.'s
 * implementation: the coarsest level gets hypot(w,h)/3 and each finer level
 * halves it.
 */
export function levelWavelength(w: number, h: number, i: number, levels: number): number {
  return (Math.hypot(w, h) / 3) / 2 ** (levels - 1 - i)
}

/**
 * Per-level amplification for motion mode.
 *
 * Wu et al. bound α by λ/(8δ) − 1 with δ = λ_c / (8(1+α)). At λ = λ_c the
 * bound equals α; finer levels are attenuated linearly towards zero. The
 * finest and coarsest levels are left untouched, as in the reference code.
 */
export function motionAlphaForLevel(
  alpha: number,
  lambdaC: number,
  w: number,
  h: number,
  level: number,
  levels: number,
): number {
  if (level === 0 || level === levels - 1) return 0
  const lambda = levelWavelength(w, h, level, levels)
  const delta = lambdaC / (8 * (1 + alpha))
  const bound = lambda / (8 * delta) - 1
  return clamp(Math.min(alpha, bound), 0, alpha)
}

/** Which levels receive temporal filtering, and with what α. */
export function levelAlphas(p: Params, w: number, h: number): number[] {
  const out: number[] = []
  for (let i = 0; i < p.levels; i++) {
    if (p.mode === 'color') {
      out.push(i === p.levels - 1 ? p.alpha : 0)
    } else {
      out.push(motionAlphaForLevel(p.alpha, p.lambdaC, w, h, i, p.levels))
    }
  }
  return out
}

// ---- URL (de)serialisation ------------------------------------------------

const URL_KEYS: Record<keyof Params, string> = {
  mode: 'm',
  alpha: 'a',
  fLow: 'lo',
  fHigh: 'hi',
  lambdaC: 'lc',
  levels: 'n',
  chroma: 'c',
  procHeight: 'r',
  blend: 'b',
  isolate: 'iso',
  denoise: 'd',
}

export function paramsToQuery(p: Params): string {
  const q = new URLSearchParams()
  for (const k of Object.keys(URL_KEYS) as (keyof Params)[]) {
    const v = p[k]
    if (v === DEFAULT_PARAMS[k]) continue
    q.set(URL_KEYS[k], typeof v === 'number' ? String(+v.toFixed(3)) : String(v))
  }
  return q.toString()
}

export function paramsFromQuery(query: string): Params {
  const q = new URLSearchParams(query)
  const p: Params = { ...DEFAULT_PARAMS }
  for (const k of Object.keys(URL_KEYS) as (keyof Params)[]) {
    const raw = q.get(URL_KEYS[k])
    if (raw === null) continue
    const def = DEFAULT_PARAMS[k]
    if (typeof def === 'number') {
      const n = Number(raw)
      if (Number.isFinite(n)) (p as unknown as Record<string, unknown>)[k] = n
    } else if (typeof def === 'boolean') {
      ;(p as unknown as Record<string, unknown>)[k] = raw === 'true' || raw === '1'
    } else {
      ;(p as unknown as Record<string, unknown>)[k] = raw
    }
  }
  return sanitize(p)
}
