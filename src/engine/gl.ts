/** Small WebGL2 helpers. Everything here throws on failure so the caller can show a message. */

export interface Target {
  fbo: WebGLFramebuffer
  textures: WebGLTexture[]
  w: number
  h: number
}

export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  })
  if (!gl) throw new Error('WebGL2 is not available in this browser.')
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('This GPU cannot render to floating point textures (EXT_color_buffer_float), which the filter needs.')
  }
  return gl
}

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('createShader failed')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`Shader compile error:\n${log}\n---\n${numbered(src)}`)
  }
  return sh
}

function numbered(src: string): string {
  return src
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(3)}: ${l}`)
    .join('\n')
}

export class Program {
  readonly prog: WebGLProgram
  private uniforms = new Map<string, WebGLUniformLocation | null>()
  constructor(
    private gl: WebGL2RenderingContext,
    vsSrc: string,
    fsSrc: string,
  ) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc)
    const prog = gl.createProgram()
    if (!prog) throw new Error('createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog)
      gl.deleteProgram(prog)
      throw new Error(`Program link error: ${log}`)
    }
    this.prog = prog
  }
  use() {
    this.gl.useProgram(this.prog)
  }
  loc(name: string): WebGLUniformLocation | null {
    let l = this.uniforms.get(name)
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name)
      this.uniforms.set(name, l)
    }
    return l
  }
  f(name: string, v: number) {
    this.gl.uniform1f(this.loc(name), v)
  }
  i(name: string, v: number) {
    this.gl.uniform1i(this.loc(name), v)
  }
  v2(name: string, x: number, y: number) {
    this.gl.uniform2f(this.loc(name), x, y)
  }
  v3(name: string, x: number, y: number, z: number) {
    this.gl.uniform3f(this.loc(name), x, y, z)
  }
  /** Bind a texture to a unit and point a sampler uniform at it. */
  tex(name: string, unit: number, texture: WebGLTexture | null) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(this.loc(name), unit)
  }
  dispose() {
    this.gl.deleteProgram(this.prog)
  }
}

export function createTexture(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  internalFormat: number,
  linear = true,
): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new Error('createTexture failed')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h)
  const f = linear ? gl.LINEAR : gl.NEAREST
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

/** A framebuffer with `count` RGBA16F colour attachments. */
export function createTarget(gl: WebGL2RenderingContext, w: number, h: number, count = 1): Target {
  const fbo = gl.createFramebuffer()
  if (!fbo) throw new Error('createFramebuffer failed')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  const textures: WebGLTexture[] = []
  const attachments: number[] = []
  for (let i = 0; i < count; i++) {
    const t = createTexture(gl, w, h, gl.RGBA16F)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0)
    textures.push(t)
    attachments.push(gl.COLOR_ATTACHMENT0 + i)
  }
  gl.drawBuffers(attachments)
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`)
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { fbo, textures, w, h }
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | undefined) {
  if (!t) return
  gl.deleteFramebuffer(t.fbo)
  for (const tex of t.textures) gl.deleteTexture(tex)
}

export function bindTarget(gl: WebGL2RenderingContext, t: Target | null, canvasW = 0, canvasH = 0) {
  if (t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.viewport(0, 0, t.w, t.h)
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvasW, canvasH)
  }
}

/** A single triangle covering the whole viewport; every pass draws with it. */
export function createFullscreenVAO(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()
  if (!vao) throw new Error('createVertexArray failed')
  gl.bindVertexArray(vao)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  return vao
}
