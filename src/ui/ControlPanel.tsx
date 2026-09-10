import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { LIMITS, PRESETS, PROC_HEIGHTS, ProcHeight } from '../engine/params'
import { useStore } from '../store'
import { RangeSlider } from './sliders/RangeSlider'
import { Slider } from './sliders/Slider'
import { fmt, linearScale, logScale, snap } from './sliders/scale'

const alphaScale = logScale(LIMITS.alpha.min, LIMITS.alpha.max)
const freqScale = logScale(LIMITS.freq.min, LIMITS.freq.max)
const lambdaScale = logScale(LIMITS.lambdaC.min, LIMITS.lambdaC.max)
const unitScale = linearScale(0, 1)
const denoiseScale = linearScale(LIMITS.denoise.min, LIMITS.denoise.max)
const levelsScale = linearScale(LIMITS.levels.min, LIMITS.levels.max)

export function ControlPanel() {
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const applyPreset = useStore((s) => s.applyPreset)
  const resetParams = useStore((s) => s.resetParams)
  const activePreset = useStore((s) => s.activePreset)
  const baseline = useStore((s) => s.baseline)
  const stats = useStore((s) => s.stats)

  const motion = params.mode === 'motion'
  const preset = PRESETS.find((p) => p.id === activePreset)
  const maxLv = stats ? Math.max(LIMITS.levels.min, Math.min(LIMITS.levels.max, Math.floor(Math.log2(Math.min(stats.procW, stats.procH) / 8)))) : LIMITS.levels.max

  return (
    <div className="flex flex-col gap-5 p-4 text-ink">
      <section>
        <SectionLabel>Presets</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className={`rounded-lg px-3 py-2 text-left text-sm transition-colors border ${
                activePreset === p.id
                  ? 'bg-accent/15 border-accent text-ink'
                  : 'bg-panel-2 border-line hover:border-muted text-ink/90'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted min-h-[2.5em]">
          {preset ? preset.hint : 'Custom settings. Double-tap a slider to return it to the preset value.'}
        </p>
      </section>

      <section>
        <SectionLabel>Mode</SectionLabel>
        <ToggleGroup.Root
          type="single"
          value={params.mode}
          onValueChange={(v) => v && setParams({ mode: v as 'color' | 'motion', chroma: v === 'color' ? 1 : 0.1 })}
          className="grid grid-cols-2 rounded-lg bg-panel-2 p-1 border border-line"
        >
          {(['color', 'motion'] as const).map((m) => (
            <ToggleGroup.Item
              key={m}
              value={m}
              className="rounded-md px-3 py-1.5 text-sm capitalize text-muted data-[state=on]:bg-accent data-[state=on]:text-bg data-[state=on]:font-medium transition-colors"
            >
              {m === 'color' ? 'Colour' : 'Motion'}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
        <p className="mt-2 text-xs text-muted">
          {motion
            ? 'Amplifies small movements. Best with a still camera.'
            : 'Amplifies subtle colour changes such as blood flow in skin.'}
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Filter</SectionLabel>
        <Slider
          label="Amplification"
          value={params.alpha}
          scale={alphaScale}
          round={(v) => (v < 10 ? snap(v, 0.1) : Math.round(v))}
          format={fmt.times}
          onChange={(alpha) => setParams({ alpha })}
          onReset={() => setParams({ alpha: baseline().alpha })}
        />
        <RangeSlider
          label="Frequency band"
          low={params.fLow}
          high={params.fHigh}
          scale={freqScale}
          minRatio={LIMITS.minBandRatio}
          format={fmt.hz}
          subFormat={fmt.bpm}
          onChange={(fLow, fHigh) => setParams({ fLow: snap(fLow, 0.01), fHigh: snap(fHigh, 0.01) })}
          onReset={() => setParams({ fLow: baseline().fLow, fHigh: baseline().fHigh })}
          hint="Changing the band restarts the temporal filter; give it a second to settle."
        />
        <Slider
          label="Spatial cutoff λc"
          value={params.lambdaC}
          scale={lambdaScale}
          round={Math.round}
          format={fmt.px}
          onChange={(lambdaC) => setParams({ lambdaC })}
          onReset={() => setParams({ lambdaC: baseline().lambdaC })}
          disabled={!motion}
          hint={motion ? 'Finer detail than this is amplified less to avoid ringing.' : 'Motion mode only.'}
        />
        <Slider
          label="Chroma amplification"
          value={params.chroma}
          scale={unitScale}
          round={(v) => snap(v, 0.05)}
          format={fmt.num2}
          onChange={(chroma) => setParams({ chroma })}
          onReset={() => setParams({ chroma: baseline().chroma })}
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Display</SectionLabel>
        <Slider
          label="Blend"
          value={params.blend}
          scale={unitScale}
          round={(v) => snap(v, 0.01)}
          format={fmt.pct}
          onChange={(blend) => setParams({ blend })}
          onReset={() => setParams({ blend: baseline().blend })}
        />
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Isolate signal
            <span className="block text-xs text-muted">Show only the amplified band on grey.</span>
          </span>
          <Switch checked={params.isolate} onChange={(isolate) => setParams({ isolate })} />
        </label>
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Processing</SectionLabel>
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm">Resolution</span>
            {stats && (
              <span className="font-mono text-xs text-muted">
                {stats.procW}×{stats.procH}
              </span>
            )}
          </div>
          <ToggleGroup.Root
            type="single"
            value={String(params.procHeight)}
            onValueChange={(v) => v && setParams({ procHeight: Number(v) as ProcHeight })}
            className="grid grid-cols-4 rounded-lg bg-panel-2 p-1 border border-line"
          >
            {PROC_HEIGHTS.map((h) => (
              <ToggleGroup.Item
                key={h}
                value={String(h)}
                className="rounded-md py-1.5 text-sm text-muted data-[state=on]:bg-panel data-[state=on]:text-ink data-[state=on]:font-medium transition-colors"
              >
                {h}p
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
          <p className="mt-1 text-xs text-muted">Lower is faster and less noisy. 360p is a good phone default.</p>
        </div>
        <Slider
          label="Pyramid levels"
          value={Math.min(params.levels, maxLv)}
          scale={levelsScale}
          round={Math.round}
          format={fmt.int}
          onChange={(levels) => setParams({ levels: Math.min(levels, maxLv) })}
          onReset={() => setParams({ levels: baseline().levels })}
          hint={motion ? 'More levels reach larger, slower structures.' : 'Only the coarsest level is filtered in colour mode.'}
        />
        <Slider
          label="Denoise"
          value={params.denoise}
          scale={denoiseScale}
          round={Math.round}
          format={fmt.int}
          onChange={(denoise) => setParams({ denoise })}
          onReset={() => setParams({ denoise: baseline().denoise })}
          hint="Spatial blur before filtering. Helps in low light."
        />
      </section>

      <button
        onClick={resetParams}
        className="self-start text-xs text-muted hover:text-ink underline underline-offset-2"
      >
        Reset everything
      </button>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</h2>
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-ink shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  )
}
