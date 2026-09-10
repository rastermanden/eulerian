import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { ControlPanel } from './ControlPanel'
import { StatsBar } from './StatsBar'
import { Viewer } from './Viewer'

export function App() {
  const panelOpen = useStore((s) => s.panelOpen)
  const setPanelOpen = useStore((s) => s.setPanelOpen)
  const setBypass = useStore((s) => s.setBypass)
  const bypass = useStore((s) => s.bypass)
  const flipCamera = useStore((s) => s.flipCamera)
  const devices = useStore((s) => s.devices)
  const cameraStatus = useStore((s) => s.cameraStatus)
  const rootRef = useRef<HTMLDivElement>(null)

  useWakeLock(cameraStatus === 'running')

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else rootRef.current?.requestFullscreen?.()
  }

  return (
    <div ref={rootRef} className="flex h-full w-full flex-col bg-bg md:flex-row">
      <main className="relative min-h-0 flex-1">
        <Viewer />
        <StatsBar />

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 safe-b">
          <div className="flex gap-2">
            {devices.length > 1 && (
              <IconButton label="Switch camera" onClick={flipCamera}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h3l2-2h6l2 2h3v12H4z" />
                  <path d="M9 13a3 3 0 0 0 6 0M15 11a3 3 0 0 0-6 0" />
                </svg>
              </IconButton>
            )}
            <IconButton label="Fullscreen" onClick={toggleFullscreen}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            </IconButton>
          </div>

          <button
            onPointerDown={() => setBypass(true)}
            onPointerUp={() => setBypass(false)}
            onPointerLeave={() => setBypass(false)}
            onPointerCancel={() => setBypass(false)}
            onContextMenu={(e) => e.preventDefault()}
            className={`select-none touch-none rounded-full px-5 py-3 text-sm font-medium shadow-lg backdrop-blur transition-colors ${
              bypass ? 'bg-ink text-bg' : 'bg-black/50 text-ink hover:bg-black/70'
            }`}
          >
            {bypass ? 'Original' : 'Hold to compare'}
          </button>

          <IconButton label={panelOpen ? 'Hide controls' : 'Show controls'} onClick={() => setPanelOpen(!panelOpen)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
              <circle cx="9" cy="6" r="2" fill="currentColor" />
              <circle cx="15" cy="12" r="2" fill="currentColor" />
              <circle cx="7" cy="18" r="2" fill="currentColor" />
            </svg>
          </IconButton>
        </div>
      </main>

      <aside
        className={`scrollbar-thin shrink-0 overflow-y-auto border-line bg-panel transition-all duration-200 md:h-full md:border-l ${
          panelOpen ? 'h-[55vh] border-t md:h-full md:w-[22rem]' : 'h-0 md:w-0'
        }`}
      >
        <header className="flex items-center justify-between px-4 pt-4">
          <h1 className="text-base font-semibold tracking-tight">Eulerian Magnifier</h1>
          <a
            href="https://people.csail.mit.edu/mrub/evm/"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted hover:text-ink"
          >
            about EVM
          </a>
        </header>
        <ControlPanel />
      </aside>
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-full bg-black/50 p-3 text-ink shadow-lg backdrop-blur hover:bg-black/70"
    >
      {children}
    </button>
  )
}

/** Keep the screen on while the camera runs (phones dim quickly otherwise). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    if (!nav.wakeLock) return
    let sentinel: { release: () => Promise<void> } | null = null
    const acquire = async () => {
      try {
        sentinel = await nav.wakeLock!.request('screen')
      } catch {
        /* denied or unsupported */
      }
    }
    const onVis = () => {
      if (!document.hidden) acquire()
    }
    acquire()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      sentinel?.release().catch(() => {})
    }
  }, [active])
}
