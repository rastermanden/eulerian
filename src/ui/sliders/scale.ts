/** Map between slider positions (0..STEPS) and real values, linear or logarithmic. */
export const STEPS = 1000

export interface Scale {
  toPos: (v: number) => number
  toValue: (pos: number) => number
}

export function linearScale(min: number, max: number): Scale {
  return {
    toPos: (v) => Math.round(((v - min) / (max - min)) * STEPS),
    toValue: (pos) => min + (pos / STEPS) * (max - min),
  }
}

export function logScale(min: number, max: number): Scale {
  const lmin = Math.log(min)
  const lmax = Math.log(max)
  return {
    toPos: (v) => Math.round(((Math.log(v) - lmin) / (lmax - lmin)) * STEPS),
    toValue: (pos) => Math.exp(lmin + (pos / STEPS) * (lmax - lmin)),
  }
}

export function snap(v: number, step: number): number {
  return Math.round(v / step) * step
}

export const fmt = {
  hz: (v: number) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} Hz`,
  bpm: (v: number) => `${Math.round(v * 60)} BPM`,
  times: (v: number) => `×${v < 10 ? v.toFixed(1) : Math.round(v)}`,
  px: (v: number) => `${Math.round(v)} px`,
  pct: (v: number) => `${Math.round(v * 100)}%`,
  num2: (v: number) => v.toFixed(2),
  int: (v: number) => String(Math.round(v)),
}
