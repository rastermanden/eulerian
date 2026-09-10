import * as RadixSlider from '@radix-ui/react-slider'
import { useState } from 'react'
import { Scale, STEPS } from './scale'

interface Props {
  label: string
  low: number
  high: number
  onChange: (low: number, high: number) => void
  onReset?: () => void
  scale: Scale
  /** high must be at least low × minRatio. */
  minRatio: number
  format: (v: number) => string
  subFormat?: (v: number) => string
  hint?: string
}

/** Two-thumb slider for the temporal band. */
export function RangeSlider({ label, low, high, onChange, onReset, scale, minRatio, format, subFormat, hint }: Props) {
  const [dragging, setDragging] = useState(false)
  const minGap = Math.round((Math.log(minRatio) / Math.log(scale.toValue(STEPS) / scale.toValue(0))) * STEPS)
  return (
    <div className="group" onDoubleClick={onReset}>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-sm text-ink">{label}</span>
        <span className="font-mono text-sm text-accent-2 tabular-nums">
          {format(low)} – {format(high)}
        </span>
      </div>
      <RadixSlider.Root
        className="relative flex items-center h-8 w-full touch-none select-none"
        min={0}
        max={STEPS}
        step={1}
        minStepsBetweenThumbs={Math.max(1, minGap)}
        value={[scale.toPos(low), scale.toPos(high)]}
        onValueChange={([a, b]) => onChange(scale.toValue(a), scale.toValue(b))}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        aria-label={label}
      >
        <RadixSlider.Track className="relative grow h-1.5 rounded-full bg-white/10">
          <RadixSlider.Range className="absolute h-full rounded-full bg-gradient-to-r from-accent to-accent-2" />
        </RadixSlider.Track>
        {[low, high].map((v, i) => (
          <RadixSlider.Thumb
            key={i}
            className="relative block h-6 w-6 rounded-full bg-ink shadow-[0_2px_8px_rgba(0,0,0,.5)] ring-2 ring-accent/70 outline-none focus-visible:ring-4 transition-transform data-[state=active]:scale-110"
            aria-label={i === 0 ? 'Low cutoff' : 'High cutoff'}
          >
            <span
              className={`pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-panel-2 px-2 py-1 font-mono text-xs text-ink shadow transition-opacity ${dragging ? 'opacity-100' : 'opacity-0'}`}
            >
              {format(v)}
            </span>
          </RadixSlider.Thumb>
        ))}
      </RadixSlider.Root>
      {subFormat && (
        <div className="flex justify-between font-mono text-xs text-muted -mt-1">
          <span>{subFormat(low)}</span>
          <span>{subFormat(high)}</span>
        </div>
      )}
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  )
}
