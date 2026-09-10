import {
  Program,
  Target,
  bindTarget,
  createContext,
  createFullscreenVAO,
  createTarget,
  deleteTarget,
} from './gl'
import { Params, iirCoefficient, levelAlphas, levelSize, processingSize } from './params'
import { FS_ACCUMULATE, FS_COMPOSITE, FS_DOWNSAMPLE, FS_LAPLACIAN, FS_TEMPORAL, FS_YIQ, VS } from './shaders'

export interface EngineStats {
  fps: number
  procW: number
  procH: number
  levels: number
  /** Per-level α actually applied this frame. */
  levelAlphas: number[]
}

export interface RenderOptions {
  /** Mirror horizontally (front camera). */
  mirror: boolean
  /** Show the raw camera frame (hold-to-compare). State still updates. */
  bypass: boolean
}

/**
 * Real-time Eulerian magnification on WebGL2.
 *
 * Per frame: camera → YIQ at processing resolution → Gaussian pyramid →
 * (motion mode) Laplacian levels → per-level IIR band-pass → amplified
 * coarse-to-fine accumulation → composite over the full-resolution frame.
 */
export class Engine {
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject
  private pYiq: Program
  private pDown: Program
  private pLap: Program
  private pTemporal: Program
  private pAcc: Program
  private pComp: Program

  private videoTex: WebGLTexture
  private videoW = 0
  private videoH = 0
  private procW = 0
  private procH = 0
  private builtLevels = 0

  private gauss: Target[] = []
  private lap: Target[] = []
  /** Two ping-pong state targets per level, each with (lo, hi) attachments. */
  private state: [Target, Target][] = []
  private stateIndex: number[] = []
  private stateValid: boolean[] = []
  private acc: Target[] = []

  private params: Params
  private resetAll = true
  private fpsEma = 0
  private lastAlphas: number[] = []

  constructor(
    private canvas: HTMLCanvasElement,
    params: Params,
  ) {
    const gl = createContext(canvas)
    this.gl = gl
    this.params = params
    this.vao = createFullscreenVAO(gl)
    this.pYiq = new Program(gl, VS, FS_YIQ)
    this.pDown = new Program(gl, VS, FS_DOWNSAMPLE)
    this.pLap = new Program(gl, VS, FS_LAPLACIAN)
    this.pTemporal = new Program(gl, VS, FS_TEMPORAL)
    this.pAcc = new Program(gl, VS, FS_ACCUMULATE)
    this.pComp = new Program(gl, VS, FS_COMPOSITE)

    const tex = gl.createTexture()
    if (!tex) throw new Error('createTexture failed')
    this.videoTex = tex
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
  }

  get stats(): EngineStats {
    return {
      fps: this.fpsEma,
      procW: this.procW,
      procH: this.procH,
      levels: this.builtLevels,
      levelAlphas: this.lastAlphas,
    }
  }

  setParams(next: Params) {
    const prev = this.params
    if (next.mode !== prev.mode || next.fLow !== prev.fLow || next.fHigh !== prev.fHigh) {
      this.resetAll = true
    }
    this.params = next
  }

  /** Clear temporal state on the next frame (e.g. after switching camera). */
  reset() {
    this.resetAll = true
  }

  /** Process one camera frame. `dt` is seconds since the previous frame. */
  render(video: HTMLVideoElement | HTMLCanvasElement, dt: number, opts: RenderOptions) {
    const gl = this.gl
    const p = this.params
    const vw = video instanceof HTMLVideoElement ? video.videoWidth : video.width
    const vh = video instanceof HTMLVideoElement ? video.videoHeight : video.height
    if (vw === 0 || vh === 0) return

    if (dt > 0 && dt < 1) {
      const fps = 1 / dt
      this.fpsEma = this.fpsEma === 0 ? fps : this.fpsEma * 0.9 + fps * 0.1
    }

    this.ensureTargets(vw, vh)

    // Upload the camera frame at native resolution.
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
    if (this.videoW !== vw || this.videoH !== vh) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      this.videoW = vw
      this.videoH = vh
      this.canvas.width = vw
      this.canvas.height = vh
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video)
    }

    gl.bindVertexArray(this.vao)
    const N = this.builtLevels
    const alphas = levelAlphas({ ...p, levels: N }, this.procW, this.procH)
    this.lastAlphas = alphas

    // 1. YIQ at processing resolution.
    this.pYiq.use()
    bindTarget(gl, this.gauss[0])
    this.pYiq.tex('u_video', 0, this.videoTex)
    this.pYiq.v2('u_texel', 1 / this.procW, 1 / this.procH)
    this.pYiq.i('u_radius', p.denoise)
    this.draw()

    // 2. Gaussian pyramid.
    this.pDown.use()
    for (let i = 1; i < N; i++) {
      const src = this.gauss[i - 1]
      bindTarget(gl, this.gauss[i])
      this.pDown.tex('u_src', 0, src.textures[0])
      this.pDown.v2('u_srcTexel', 1 / src.w, 1 / src.h)
      this.draw()
    }

    // 3. Laplacian levels (motion mode only).
    const motion = p.mode === 'motion'
    if (motion) {
      this.pLap.use()
      for (let i = 0; i < N - 1; i++) {
        if (alphas[i] <= 0) continue
        bindTarget(gl, this.lap[i])
        this.pLap.tex('u_fine', 0, this.gauss[i].textures[0])
        this.pLap.tex('u_coarse', 1, this.gauss[i + 1].textures[0])
        this.draw()
      }
    }

    // 4. Temporal IIR per active level.
    const rLo = iirCoefficient(p.fLow, dt)
    const rHi = iirCoefficient(p.fHigh, dt)
    this.pTemporal.use()
    for (let i = 0; i < N; i++) {
      if (alphas[i] <= 0) {
        this.stateValid[i] = false
        continue
      }
      const input = motion && i < N - 1 ? this.lap[i] : this.gauss[i]
      const read = this.state[i][this.stateIndex[i]]
      const write = this.state[i][1 - this.stateIndex[i]]
      bindTarget(gl, write)
      this.pTemporal.tex('u_input', 0, input.textures[0])
      this.pTemporal.tex('u_lo', 1, read.textures[0])
      this.pTemporal.tex('u_hi', 2, read.textures[1])
      this.pTemporal.f('u_rLo', rLo)
      this.pTemporal.f('u_rHi', rHi)
      this.pTemporal.i('u_reset', this.resetAll || !this.stateValid[i] ? 1 : 0)
      this.draw()
      this.stateIndex[i] = 1 - this.stateIndex[i]
      this.stateValid[i] = true
    }
    this.resetAll = false

    // 5. Coarse-to-fine accumulation of the amplified band.
    this.pAcc.use()
    for (let i = N - 1; i >= 0; i--) {
      const hasBand = alphas[i] > 0
      bindTarget(gl, this.acc[i])
      const st = this.state[i][this.stateIndex[i]]
      this.pAcc.tex('u_lo', 0, st.textures[0])
      this.pAcc.tex('u_hi', 1, st.textures[1])
      this.pAcc.tex('u_prev', 2, i < N - 1 ? this.acc[i + 1].textures[0] : null)
      this.pAcc.i('u_hasBand', hasBand ? 1 : 0)
      this.pAcc.i('u_hasPrev', i < N - 1 ? 1 : 0)
      this.pAcc.f('u_alpha', alphas[i])
      this.pAcc.f('u_chroma', p.chroma)
      this.draw()
    }

    // 6. Composite to the canvas.
    this.pComp.use()
    bindTarget(gl, null, this.canvas.width, this.canvas.height)
    this.pComp.tex('u_video', 0, this.videoTex)
    this.pComp.tex('u_acc', 1, this.acc[0].textures[0])
    this.pComp.f('u_blend', p.blend)
    this.pComp.i('u_isolate', p.isolate ? 1 : 0)
    this.pComp.i('u_mirror', opts.mirror ? 1 : 0)
    this.pComp.i('u_bypass', opts.bypass ? 1 : 0)
    this.draw()

    gl.bindVertexArray(null)
  }

  private draw() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
  }

  private ensureTargets(vw: number, vh: number) {
    const { w, h } = processingSize(vw, vh, this.params.procHeight)
    const N = this.params.levels
    if (w === this.procW && h === this.procH && N === this.builtLevels) return
    this.destroyTargets()
    const gl = this.gl
    this.procW = w
    this.procH = h
    this.builtLevels = N
    for (let i = 0; i < N; i++) {
      const s = levelSize(w, h, i)
      this.gauss.push(createTarget(gl, s.w, s.h))
      this.lap.push(createTarget(gl, s.w, s.h))
      this.state.push([createTarget(gl, s.w, s.h, 2), createTarget(gl, s.w, s.h, 2)])
      this.stateIndex.push(0)
      this.stateValid.push(false)
      this.acc.push(createTarget(gl, s.w, s.h))
    }
    this.resetAll = true
  }

  private destroyTargets() {
    const gl = this.gl
    for (const t of this.gauss) deleteTarget(gl, t)
    for (const t of this.lap) deleteTarget(gl, t)
    for (const pair of this.state) for (const t of pair) deleteTarget(gl, t)
    for (const t of this.acc) deleteTarget(gl, t)
    this.gauss = []
    this.lap = []
    this.state = []
    this.stateIndex = []
    this.stateValid = []
    this.acc = []
  }

  dispose() {
    this.destroyTargets()
    const gl = this.gl
    gl.deleteTexture(this.videoTex)
    gl.deleteVertexArray(this.vao)
    for (const p of [this.pYiq, this.pDown, this.pLap, this.pTemporal, this.pAcc, this.pComp]) p.dispose()
    // The context itself is left alive: a new Engine may be created on the
    // same canvas (React StrictMode remounts, camera restarts).
  }
}
