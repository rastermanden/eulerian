/** Camera access helpers. All functions are best-effort and report what they could do. */

export type Facing = 'user' | 'environment'

export interface CameraInfo {
  deviceId: string
  label: string
}

export interface LockResult {
  exposure: 'locked' | 'unsupported' | 'failed'
  whiteBalance: 'locked' | 'unsupported' | 'failed'
}

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function isSecure(): boolean {
  return typeof window !== 'undefined' && (window.isSecureContext || location.hostname === 'localhost')
}

export async function listCameras(): Promise<CameraInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
}

export interface OpenOptions {
  facing: Facing
  deviceId?: string
  /** Preferred capture height. The browser picks the closest it can. */
  height?: number
  frameRate?: number
}

export async function openCamera(opts: OpenOptions): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    width: { ideal: opts.height ? Math.round((opts.height * 16) / 9) : 1280 },
    height: { ideal: opts.height ?? 720 },
    frameRate: { ideal: opts.frameRate ?? 30 },
  }
  if (opts.deviceId) video.deviceId = { exact: opts.deviceId }
  else video.facingMode = { ideal: opts.facing }
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false })
  } catch (e) {
    // Fall back to any camera if the constraints were too specific.
    if (opts.deviceId || opts.height) {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: opts.facing } }, audio: false })
    }
    throw e
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop())
}

/**
 * Try to freeze exposure and white balance. Automatic adjustment fights the
 * colour signal we want to amplify. Support is patchy (mostly Android Chrome).
 */
export async function lockExposure(track: MediaStreamTrack): Promise<LockResult> {
  const result: LockResult = { exposure: 'unsupported', whiteBalance: 'unsupported' }
  const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>
  const settings = track.getSettings() as Record<string, unknown>

  const exposureModes = caps.exposureMode as string[] | undefined
  if (exposureModes?.includes('manual')) {
    try {
      const advanced: Record<string, unknown> = { exposureMode: 'manual' }
      if (typeof settings.exposureTime === 'number') advanced.exposureTime = settings.exposureTime
      await track.applyConstraints({ advanced: [advanced] } as MediaTrackConstraints)
      result.exposure = 'locked'
    } catch {
      result.exposure = 'failed'
    }
  }

  const wbModes = caps.whiteBalanceMode as string[] | undefined
  if (wbModes?.includes('manual')) {
    try {
      const advanced: Record<string, unknown> = { whiteBalanceMode: 'manual' }
      if (typeof settings.colorTemperature === 'number') advanced.colorTemperature = settings.colorTemperature
      await track.applyConstraints({ advanced: [advanced] } as MediaTrackConstraints)
      result.whiteBalance = 'locked'
    } catch {
      result.whiteBalance = 'failed'
    }
  }
  return result
}

/** Front cameras are usually mirrored for the user; detect that from the track. */
export function trackFacing(track: MediaStreamTrack): Facing | undefined {
  const f = (track.getSettings() as { facingMode?: string }).facingMode
  if (f === 'user' || f === 'environment') return f
  return undefined
}

type FrameCb = (now: number, dtSeconds: number) => void

/**
 * Call `cb` for each new video frame using requestVideoFrameCallback when
 * available (accurate per-frame timing), else requestAnimationFrame.
 * Returns a stop function.
 */
export function onVideoFrames(video: HTMLVideoElement, cb: FrameCb): () => void {
  let stopped = false
  let last = -1
  let handle = 0
  const rvfc = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number
    cancelVideoFrameCallback?: (h: number) => void
  }).requestVideoFrameCallback?.bind(video)

  if (rvfc) {
    const tick = (now: number, meta: { mediaTime: number }) => {
      if (stopped) return
      const t = meta.mediaTime
      const dt = last < 0 ? 0 : t - last
      last = t
      cb(now, dt)
      handle = rvfc(tick)
    }
    handle = rvfc(tick)
    return () => {
      stopped = true
      ;(video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }).cancelVideoFrameCallback?.(handle)
    }
  }

  const tick = (now: number) => {
    if (stopped) return
    const t = now / 1000
    const dt = last < 0 ? 0 : t - last
    last = t
    if (video.readyState >= 2) cb(now, dt)
    handle = requestAnimationFrame(tick)
  }
  handle = requestAnimationFrame(tick)
  return () => {
    stopped = true
    cancelAnimationFrame(handle)
  }
}
