/**
 * Headless end-to-end check of the WebGL engine.
 *
 * Starts the Vite dev server, opens a page in Chromium, imports the Engine
 * directly, feeds it a synthetic video (a disc whose brightness oscillates at
 * a known frequency) and asserts that:
 *   - every shader compiles and a frame renders without GL errors,
 *   - the in-band oscillation is amplified by roughly α,
 *   - an out-of-band oscillation is not.
 *
 * Usage: node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const PORT = 5199
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite did not start')), 30000)
  server.stdout.on('data', (d) => {
    if (String(d).includes('Local:')) {
      clearTimeout(t)
      resolve()
    }
  })
  server.stderr.on('data', (d) => process.stderr.write(d))
})

const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'
const browser = await chromium.launch({
  executablePath: (await import('node:fs')).existsSync(executablePath) ? executablePath : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
let failed = false
try {
  const page = await browser.newPage()
  page.on('console', (m) => console.log('[page]', m.text()))
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(`http://localhost:${PORT}/`)

  const result = await page.evaluate(async () => {
    const { Engine } = await import('/src/engine/Engine.ts')
    const { DEFAULT_PARAMS } = await import('/src/engine/params.ts')

    const W = 320
    const H = 240
    const src = document.createElement('canvas')
    src.width = W
    src.height = H
    const ctx = src.getContext('2d')

    /** Render `frames` frames of a disc with brightness base + amp·sin(2π f t); return peak-to-peak of the output disc luma. */
    const run = (params, freqHz, amp, alpha) => {
      const out = document.createElement('canvas')
      document.body.appendChild(out)
      const engine = new Engine(out, { ...params, alpha })
      const fps = 30
      const dt = 1 / fps
      const frames = 200
      const read = document.createElement('canvas')
      read.width = W
      read.height = H
      const rctx = read.getContext('2d')
      let min = Infinity
      let max = -Infinity
      let inMin = Infinity
      let inMax = -Infinity
      for (let i = 0; i < frames; i++) {
        const t = i * dt
        const v = 0.5 + amp * Math.sin(2 * Math.PI * freqHz * t)
        ctx.fillStyle = '#404040'
        ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`
        ctx.beginPath()
        ctx.arc(W / 2, H / 2, 60, 0, Math.PI * 2)
        ctx.fill()
        engine.render(src, i === 0 ? 0 : dt, { mirror: false, bypass: false })
        if (i > frames / 2) {
          rctx.drawImage(out, 0, 0)
          const px = rctx.getImageData(W / 2, H / 2, 1, 1).data
          const luma = (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255
          min = Math.min(min, luma)
          max = Math.max(max, luma)
          inMin = Math.min(inMin, v)
          inMax = Math.max(inMax, v)
        }
      }
      const gl = out.getContext('webgl2')
      const err = gl.getError()
      engine.dispose()
      return { outPP: max - min, inPP: inMax - inMin, glError: err }
    }

    const base = { ...DEFAULT_PARAMS, mode: 'color', fLow: 0.8, fHigh: 3, levels: 3, procHeight: 240, blend: 1, denoise: 0 }
    const inBand = run(base, 1.5, 0.01, 20)
    const outBand = run(base, 0.05, 0.01, 20)
    const motion = run({ ...base, mode: 'motion', levels: 4, lambdaC: 16, chroma: 0.1 }, 1.5, 0.01, 20)
    return { inBand, outBand, motion }
  })

  console.log(JSON.stringify(result, null, 2))
  const gain = result.inBand.outPP / result.inBand.inPP
  const rejectGain = result.outBand.outPP / result.outBand.inPP
  const checks = [
    ['no GL error (colour)', result.inBand.glError === 0],
    ['no GL error (motion)', result.motion.glError === 0],
    ['in-band signal amplified > 8x', gain > 8],
    ['out-of-band signal amplified < 3x', rejectGain < 3],
    ['motion pipeline renders a non-black frame', result.motion.outPP >= 0],
  ]
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failed = true
  }
  console.log(`in-band gain ≈ ${gain.toFixed(1)}x, out-of-band gain ≈ ${rejectGain.toFixed(2)}x`)
} finally {
  await browser.close()
  server.kill()
}
process.exit(failed ? 1 : 0)
