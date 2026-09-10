import { useEffect, useRef, useState } from 'react'
import {
  cameraSupported,
  isSecure,
  listCameras,
  lockExposure,
  onVideoFrames,
  openCamera,
  stopStream,
  trackFacing,
} from '../camera/camera'
import { Engine } from '../engine/Engine'
import { useStore } from '../store'

/** Camera preview + WebGL output. Owns the stream, the engine and the frame loop. */
export function Viewer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)

  const facing = useStore((s) => s.facing)
  const deviceId = useStore((s) => s.deviceId)
  const setCamera = useStore((s) => s.setCamera)
  const cameraStatus = useStore((s) => s.cameraStatus)
  const cameraError = useStore((s) => s.cameraError)
  const params = useStore((s) => s.params)
  const retry = useStore((s) => s.retry)
  const [mirror, setMirror] = useState(facing === 'user')
  // Mirror flag readable from the frame loop without re-subscribing.
  const mirrorRef = useRef(mirror)
  mirrorRef.current = mirror

  // Engine lifetime: created once with the canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      engineRef.current = new Engine(canvas, useStore.getState().params)
      setEngineError(null)
    } catch (e) {
      setEngineError((e as Error).message)
    }
    return () => {
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setParams(params)
  }, [params])

  // Camera stream: reopen when facing or device changes.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!cameraSupported()) {
      setCamera({ cameraStatus: 'error', cameraError: 'This browser does not support camera access.' })
      return
    }
    if (!isSecure()) {
      setCamera({ cameraStatus: 'error', cameraError: 'Camera access needs a secure (https://) page.' })
      return
    }
    let cancelled = false
    let stream: MediaStream | null = null
    let stopFrames: (() => void) | null = null
    setCamera({ cameraStatus: 'starting', cameraError: null, lock: null })

    ;(async () => {
      try {
        stream = await openCamera({ facing, deviceId })
        if (cancelled) return stopStream(stream)
        const track = stream.getVideoTracks()[0]
        setMirror((trackFacing(track) ?? facing) === 'user')
        video.srcObject = stream
        await video.play()
        if (cancelled) return
        engineRef.current?.reset()
        setCamera({ cameraStatus: 'running', devices: await listCameras() })
        lockExposure(track).then((lock) => !cancelled && setCamera({ lock }))
        track.addEventListener('ended', () => {
          if (!cancelled) setCamera({ cameraStatus: 'error', cameraError: 'The camera stopped.' })
        })

        let statsTick = 0
        stopFrames = onVideoFrames(video, (_now, dt) => {
          const engine = engineRef.current
          if (!engine || document.hidden) return
          const { bypass } = useStore.getState()
          try {
            engine.render(video, dt, { mirror: mirrorRef.current, bypass })
          } catch (e) {
            setEngineError((e as Error).message)
            stopFrames?.()
          }
          if (++statsTick % 15 === 0) useStore.getState().setStats(engine.stats)
        })
      } catch (e) {
        if (cancelled) return
        const err = e as DOMException
        const msg =
          err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access for this site and reload.'
            : err.name === 'NotFoundError'
              ? 'No camera was found.'
              : err.name === 'NotReadableError'
                ? 'The camera is in use by another app.'
                : `Could not start the camera: ${err.message}`
        setCamera({ cameraStatus: 'error', cameraError: msg })
      }
    })()

    return () => {
      cancelled = true
      stopFrames?.()
      stopStream(stream)
      video.srcObject = null
    }
  }, [facing, deviceId, retry, setCamera])

  // Reset the filter when the tab comes back, so the user does not see a stale transient.
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) engineRef.current?.reset()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const message = engineError ?? cameraError

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} playsInline muted autoPlay className="hidden" />
      <canvas ref={canvasRef} className="h-full w-full object-contain" />
      {cameraStatus === 'starting' && !message && (
        <Overlay>
          <Spinner />
          <p className="text-sm text-muted">Starting camera…</p>
        </Overlay>
      )}
      {message && (
        <Overlay>
          <p className="max-w-sm text-center text-sm text-ink/90">{message}</p>
          {cameraStatus === 'error' && (
            <button
              onClick={() => useStore.getState().retryCamera()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg"
            >
              Try again
            </button>
          )}
        </Overlay>
      )}
    </div>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bg/80 p-6 backdrop-blur-sm">
      {children}
    </div>
  )
}

function Spinner() {
  return <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
}
