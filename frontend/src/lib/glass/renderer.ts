import { MAX_PIXELS, morph } from "./pixels";
import { FRAGMENT, VERTEX } from "./shader";

/** Layout of the toggle in CSS pixels. The canvas is larger than the button so light can spill out. */
export const TOGGLE = {
  width: 76,
  height: 40,
  radius: 12,
  inset: 3,
  knob: 34,
  knobRadius: 9,
  cell: 2.1, // pixel-matrix pitch
  spill: 26, // canvas margin around the track
} as const;

export const TRAVEL = TOGGLE.width - 2 * TOGGLE.inset - TOGGLE.knob;
export const CANVAS = { width: TOGGLE.width + 2 * TOGGLE.spill, height: TOGGLE.height + 2 * TOGGLE.spill };

export interface GlassRenderer {
  resize: (devicePixelRatio: number) => void;
  /** position: 0 = night (knob left) .. 1 = day (knob right). */
  draw: (position: number, lightPage: boolean) => void;
  dispose: () => void;
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;

function compile(gl: GL, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn("Glass toggle shader:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function link(gl: GL): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn("Glass toggle program:", gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

/** Returns null when WebGL isn't available, so the caller can show a plain switch instead. */
export function createGlassRenderer(canvas: HTMLCanvasElement): GlassRenderer | null {
  const options: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false };
  const gl: GL | null = canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options);
  if (!gl || gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) < MAX_PIXELS + 16) return null;
  const program = link(gl);
  if (!program) return null;

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);

  const at = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    res: at("u_res"),
    dpr: at("u_dpr"),
    knobC: at("u_knobC"),
    pos: at("u_pos"),
    light: at("u_light"),
    pix: at("u_pix"),
  };
  const { width, height, radius, inset, knob, knobRadius, cell, spill } = TOGGLE;
  gl.uniform2f(at("u_trackC"), spill + width / 2, spill + height / 2);
  gl.uniform2f(at("u_trackHalf"), width / 2, height / 2);
  gl.uniform1f(at("u_trackR"), radius);
  gl.uniform1f(at("u_knobHalf"), knob / 2);
  gl.uniform1f(at("u_knobR"), knobRadius);
  gl.uniform1f(at("u_cell"), cell);

  const pixels = new Float32Array(MAX_PIXELS * 4);
  let ratio = 1;

  return {
    resize(devicePixelRatio) {
      ratio = Math.min(2, Math.max(1, devicePixelRatio));
      canvas.width = Math.round(CANVAS.width * ratio);
      canvas.height = Math.round(CANVAS.height * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    draw(positionValue, lightPage) {
      const p = Math.min(1, Math.max(0, positionValue));
      pixels.fill(0);
      morph(p).forEach((px, i) => pixels.set([px.x * cell, px.y * cell, px.size * cell, px.sun], i * 4));
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.dpr, ratio);
      gl.uniform2f(u.knobC, spill + inset + knob / 2 + p * TRAVEL, spill + height / 2);
      gl.uniform1f(u.pos, p);
      gl.uniform1f(u.light, lightPage ? 1 : 0);
      gl.uniform4fv(u.pix, pixels);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
