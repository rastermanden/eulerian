import * as RadixSlider from '@radix-ui/react-slider'
import { useState } from 'react'
import { Scale, STEPS } from './scale'

interface Props {
  label: string
  value: number
  onChange: (v: number) => void
  /** Value to jump to on double-tap. */
  onReset?: () => void
  scale: Scale
  /** Rounding applied to the value after mapping from the track. */
  round?: (v: number) => number
  format: (v: number) => string
  hint?: string
  disabled?: boolean
}

export function Slider({ label, value, onChange, onReset, scale, round, format, hint, disabled }: Props) {
  const [dragging, setDragging] = useState(false)
  return (
    <div className={`group ${disabled ? 'opacity-40 pointer-events-none' : ''}`} onDoubleClick={onReset}>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-sm text-ink">{label}</span>
        <span className="font-mono text-sm text-accent-2 tabular-nums">{format(value)}</span>
      </div>
      <RadixSlider.Root
        className="relative flex items-center h-8 w-full touch-none select-none"
        min={0}
        max={STEPS}
        step={1}
        value={[scale.toPos(value)]}
        onValueChange={([p]) => {
          let v = scale.toValue(p)
          if (round) v = round(v)
          onChange(v)
        }}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        aria-label={label}
      >
        <RadixSlider.Track className="relative grow h-1.5 rounded-full bg-white/10">
          <RadixSlider.Range className="absolute h-full rounded-full bg-accent" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="relative block h-6 w-6 rounded-full bg-ink shadow-[0_2px_8px_rgba(0,0,0,.5)] ring-2 ring-accent/70 outline-none focus-visible:ring-4 transition-transform data-[state=active]:scale-110">
          <span
            className={`pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 rounded-md bg-panel-2 px-2 py-1 font-mono text-xs text-ink shadow transition-opacity ${dragging ? 'opacity-100' : 'opacity-0'}`}
          >
            {format(value)}
          </span>
        </RadixSlider.Thumb>
      </RadixSlider.Root>
      {hint && <p className="text-xs text-muted -mt-1">{hint}</p>}
    </div>
  )
}
