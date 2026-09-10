import { useStore } from '../store'

export function StatsBar() {
  const stats = useStore((s) => s.stats)
  const lock = useStore((s) => s.lock)
  const status = useStore((s) => s.cameraStatus)
  if (status !== 'running' || !stats) return null
  const exposure = lock?.exposure === 'locked' ? 'exposure locked' : lock?.exposure === 'failed' ? 'exposure lock failed' : 'auto exposure'
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2 font-mono text-[11px] text-ink/80 safe-t">
      <Chip>{Math.round(stats.fps)} fps</Chip>
      <Chip>
        {stats.procW}×{stats.procH}
      </Chip>
      <Chip>{stats.levels} levels</Chip>
      <Chip>α {stats.levelAlphas.map((a) => (a >= 10 ? Math.round(a) : a.toFixed(1))).join(' / ')}</Chip>
      <Chip>{exposure}</Chip>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-black/50 px-2 py-1 backdrop-blur">{children}</span>
}
