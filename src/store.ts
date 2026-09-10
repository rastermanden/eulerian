import { create } from 'zustand'
import {
  DEFAULT_PARAMS,
  PRESETS,
  Params,
  paramsFromQuery,
  paramsToQuery,
  sanitize,
} from './engine/params'
import type { CameraInfo, Facing, LockResult } from './camera/camera'
import type { EngineStats } from './engine/Engine'

export type CameraStatus = 'idle' | 'starting' | 'running' | 'error'

interface State {
  params: Params
  /** Preset the current params were derived from, or null once edited. */
  activePreset: string | null
  setParams: (patch: Partial<Params>) => void
  applyPreset: (id: string) => void
  resetParams: () => void
  /** Value a slider should return to on double-tap. */
  baseline: () => Params

  facing: Facing
  deviceId: string | undefined
  devices: CameraInfo[]
  cameraStatus: CameraStatus
  cameraError: string | null
  lock: LockResult | null
  setCamera: (patch: Partial<Pick<State, 'facing' | 'deviceId' | 'devices' | 'cameraStatus' | 'cameraError' | 'lock'>>) => void
  flipCamera: () => void
  retry: number
  retryCamera: () => void

  bypass: boolean
  setBypass: (v: boolean) => void
  panelOpen: boolean
  setPanelOpen: (v: boolean) => void

  stats: EngineStats | null
  setStats: (s: EngineStats) => void
}

const initialParams = typeof location !== 'undefined' ? paramsFromQuery(location.search) : DEFAULT_PARAMS

export const useStore = create<State>((set, get) => ({
  params: initialParams,
  activePreset: matchPreset(initialParams),
  setParams: (patch) =>
    set((s) => {
      const params = sanitize({ ...s.params, ...patch })
      return { params, activePreset: matchPreset(params) }
    }),
  applyPreset: (id) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    set((s) => ({
      params: sanitize({ ...s.params, ...preset.params }),
      activePreset: id,
    }))
  },
  resetParams: () => set({ params: { ...DEFAULT_PARAMS }, activePreset: matchPreset(DEFAULT_PARAMS) }),
  baseline: () => {
    const { activePreset } = get()
    const preset = PRESETS.find((p) => p.id === activePreset)
    return sanitize({ ...DEFAULT_PARAMS, ...(preset?.params ?? {}) })
  },

  facing: 'user',
  deviceId: undefined,
  devices: [],
  cameraStatus: 'idle',
  cameraError: null,
  lock: null,
  setCamera: (patch) => set(patch),
  flipCamera: () => set((s) => ({ facing: s.facing === 'user' ? 'environment' : 'user', deviceId: undefined })),
  retry: 0,
  retryCamera: () => set((s) => ({ retry: s.retry + 1, cameraStatus: 'idle', cameraError: null })),

  bypass: false,
  setBypass: (v) => set({ bypass: v }),
  panelOpen: true,
  setPanelOpen: (v) => set({ panelOpen: v }),

  stats: null,
  setStats: (stats) => set({ stats }),
}))

/** A preset is "active" only while every field it sets still matches. */
function matchPreset(p: Params): string | null {
  for (const preset of PRESETS) {
    const ok = (Object.keys(preset.params) as (keyof Params)[]).every((k) => p[k] === preset.params[k])
    if (ok) return preset.id
  }
  return null
}

// Keep the URL in sync so settings can be shared.
if (typeof window !== 'undefined') {
  let timer: number | undefined
  useStore.subscribe((s, prev) => {
    if (s.params === prev.params) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      const q = paramsToQuery(s.params)
      const url = `${location.pathname}${q ? `?${q}` : ''}${location.hash}`
      history.replaceState(null, '', url)
    }, 250)
  })
}
