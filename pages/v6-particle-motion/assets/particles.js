// particles.js — v6-particle-motion runtime particle system
// Hand-rolled WebGL (preferred) → Canvas 2D (fallback) → DOM-keyframe (last resort).
// Self-contained ES module. No external dependencies. ~5 KB minified.
//
// Usage:
//   <canvas id="particles-canvas" data-particle-density="medium"></canvas>
//   <script type="module">
//     import { initParticles } from './assets/particles.js';
//     initParticles({ container: document.querySelector('.hero') });
//   </script>
//
// Public API: initParticles(opts), pauseParticles(), resumeParticles(), destroyParticles().
// Honors prefers-reduced-motion via the prefers-reduced-motion.js guard module —
// if loaded, this module reads window.__prefersReducedMotion at start and skips motion.

const PALETTE = {
  // v5-futuristic signal palette — tuned for plum-ink background.
  // Designer can override via window.__particlePalette before init.
  warm:    [0.85, 0.41, 0.31],  // terracotta-signal #D9684E
  neutral: [0.95, 0.91, 0.87],  // bone-text          #F2E9DE
  accent:  [0.79, 0.60, 0.26],  // brass-signal       #C99A42
  cool:    [0.29, 0.54, 0.45],  // moss (rarely used) #4A8A73
};

const DENSITY = { low: 60, medium: 180, high: 360 };

let _state = null;

function mergePalette(custom) {
  if (!custom) return PALETTE;
  const out = { ...PALETTE };
  for (const k of Object.keys(custom)) {
    if (Array.isArray(custom[k]) && custom[k].length === 3) {
      out[k] = custom[k].map((v) => v / (v > 1 ? 255 : 1));
    }
  }
  return out;
}

function pickPaletteColor(palette) {
  const keys = Object.keys(palette).filter((k) => k !== 'cool');
  // ~70% warm, ~20% neutral, ~10% accent — keeps hero non-AI-stereotypical.
  const r = Math.random();
  if (r < 0.70) return palette.warm;
  if (r < 0.90) return palette.neutral;
  return palette.accent;
}

// =====================================================================
// WebGL path
// =====================================================================
function buildWebGL(canvas, opts) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true })
          || canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true })
          || canvas.getContext('experimental-webgl', { premultipliedAlpha: true, alpha: true });
  if (!gl) return null;

  const vertSrc = `
    attribute vec2 a_pos;        // -1..1 NDC
    attribute float a_size;      // base point size in px
    attribute float a_alpha;     // per-particle alpha
    attribute vec3 a_color;      // per-particle rgb
    uniform vec2 u_resolution;   // canvas size in px
    uniform vec2 u_mouse;        // mouse in NDC (-1..1), y-up
    uniform float u_dpr;         // device pixel ratio
    uniform float u_time;        // seconds since start
    varying float v_alpha;
    varying vec3 v_color;
    void main() {
      vec2 p = a_pos;
      // gentle drift driven by time + per-particle offsets encoded in a_pos.x of dummy attr
      float t = u_time * 0.06;
      p.x += sin(t + a_pos.y * 6.28) * 0.0025;
      p.y += cos(t + a_pos.x * 6.28) * 0.0025;
      // mouse repel: stronger when closer, decays smoothly
      vec2 md = p - u_mouse;
      float md2 = dot(md, md);
      float repel = 0.18 / (md2 * 30.0 + 1.0);
      p += normalize(md + vec2(1e-5)) * repel;
      gl_Position = vec4(p, 0.0, 1.0);
      gl_PointSize = a_size * u_dpr;
      v_alpha = a_alpha;
      v_color = a_color;
    }
  `;
  const fragSrc = `
    precision mediump float;
    varying float v_alpha;
    varying vec3 v_color;
    void main() {
      vec2 uv = gl_PointCoord - vec2(0.5);
      float d = length(uv);
      // soft circle with bright core
      float a = smoothstep(0.5, 0.0, d);
      a = pow(a, 1.6);
      // warm inner tint
      vec3 c = mix(vec3(1.0), v_color, 0.85);
      gl_FragColor = vec4(c, a * v_alpha);
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[particles] shader compile failed:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[particles] program link failed:', gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const locPos    = gl.getAttribLocation(prog, 'a_pos');
  const locSize   = gl.getAttribLocation(prog, 'a_size');
  const locAlpha  = gl.getAttribLocation(prog, 'a_alpha');
  const locColor  = gl.getAttribLocation(prog, 'a_color');
  const uRes      = gl.getUniformLocation(prog, 'u_resolution');
  const uMouse    = gl.getUniformLocation(prog, 'u_mouse');
  const uDpr      = gl.getUniformLocation(prog, 'u_dpr');
  const uTime     = gl.getUniformLocation(prog, 'u_time');

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive — particles glow, don't muddy

  const count = Math.min(opts.count, 1200);
  const positions = new Float32Array(count * 2);
  const sizes     = new Float32Array(count);
  const alphas    = new Float32Array(count);
  const colors    = new Float32Array(count * 3);
  const seeds     = new Float32Array(count); // for client-side drift

  const palette = opts.palette;
  for (let i = 0; i < count; i++) {
    positions[i * 2]     = (Math.random() * 2 - 1);
    positions[i * 2 + 1] = (Math.random() * 2 - 1);
    sizes[i]  = 1.4 + Math.random() * 3.2;
    alphas[i] = 0.25 + Math.random() * 0.55;
    const c = pickPaletteColor(palette);
    colors[i * 3]     = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
    seeds[i] = Math.random();
  }

  function mkBuffer(data, loc, size) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return buf;
  }
  mkBuffer(positions, locPos,   2);
  mkBuffer(sizes,    locSize,  1);
  mkBuffer(alphas,   locAlpha, 1);
  mkBuffer(colors,   locColor, 3);

  return {
    gl, prog, uRes, uMouse, uDpr, uTime, count,
    resize(w, h, dpr) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uDpr, dpr);
    },
    render(time, mouseNdc) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, time);
      gl.uniform2f(uMouse, mouseNdc[0], mouseNdc[1]);
      gl.drawArrays(gl.POINTS, 0, count);
    },
  };
}

// =====================================================================
// Canvas 2D fallback
// =====================================================================
function buildCanvas2D(canvas, opts) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const count = Math.min(opts.count, 200);
  const dpr = opts.dpr;
  const particles = [];
  const palette = opts.palette;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.6,
      vx: (Math.random() - 0.5) * 0.00012,
      vy: (Math.random() - 0.5) * 0.00012,
      a: 0.25 + Math.random() * 0.55,
      color: pickPaletteColor(palette),
      seed: Math.random() * Math.PI * 2,
    });
  }
  return {
    ctx, count,
    resize(w, h) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    },
    render(time, mouseNdc) {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < count; i++) {
        const p = particles[i];
        // drift
        p.x += p.vx + Math.sin(time * 0.0006 + p.seed) * 0.00008;
        p.y += p.vy + Math.cos(time * 0.0006 + p.seed) * 0.00008;
        if (p.x < 0) p.x = 1; if (p.x > 1) p.x = 0;
        if (p.y < 0) p.y = 1; if (p.y > 1) p.y = 0;
        // mouse repel
        const mx = (mouseNdc[0] * 0.5 + 0.5);
        const my = (1 - (mouseNdc[1] * 0.5 + 0.5));
        const dx = p.x - mx, dy = p.y - my;
        const d2 = dx * dx + dy * dy + 0.001;
        const force = 0.00018 / d2;
        p.x += (dx / Math.sqrt(d2)) * force;
        p.y += (dy / Math.sqrt(d2)) * force;
        // draw
        const px = p.x * W, py = p.y * H;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, p.r * dpr * 4);
        const [r, g, b] = p.color;
        grad.addColorStop(0, `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${p.a})`);
        grad.addColorStop(1, `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, p.r * dpr * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

// =====================================================================
// Public init
// =====================================================================
export function initParticles(opts = {}) {
  if (_state) return _state; // idempotent

  const container = opts.container || document.querySelector('[data-particles]') || document.body;
  const prefersReduced = !!window.__prefersReducedMotion;

  // Find or create the canvas element.
  let canvas = container.querySelector('canvas[data-particles-canvas]');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.setAttribute('data-particles-canvas', '');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '0';
    const pos = getComputedStyle(container).position;
    if (pos === 'static') container.style.position = 'relative';
    container.prepend(canvas);
  }

  const density = (opts.density || canvas.dataset.particleDensity || 'medium').toLowerCase();
  const count = opts.count || DENSITY[density] || DENSITY.medium;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const palette = mergePalette(opts.palette || window.__particlePalette);

  // Try WebGL first, then Canvas 2D, then DOM-keyframe fallback.
  let renderer = null;
  let mode = 'dom';
  // Skip WebGL entirely if prefers-reduced-motion — saves CPU + battery.
  if (!prefersReduced) {
    renderer = buildWebGL(canvas, { count, palette, dpr });
    if (renderer) mode = 'webgl';
    else {
      renderer = buildCanvas2D(canvas, { count, palette, dpr });
      if (renderer) mode = 'canvas2d';
    }
  }

  // DOM-keyframe fallback — pure CSS, no JS animation loop.
  if (mode === 'dom') {
    const n = Math.min(40, Math.round(count / 4));
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'particle-dom';
      d.style.left = (Math.random() * 100) + '%';
      d.style.top = (Math.random() * 100) + '%';
      d.style.animationDelay = (Math.random() * 12) + 's';
      d.style.animationDuration = (10 + Math.random() * 18) + 's';
      fragment.appendChild(d);
    }
    container.appendChild(fragment);
    return { mode: 'dom', destroy: () => {
      container.querySelectorAll('.particle-dom').forEach((el) => el.remove());
    }};
  }

  // Mouse tracking in NDC.
  const mouseNdc = [0, 0];
  let mouseTarget = [0, 0];
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    mouseTarget[0] = x;
    mouseTarget[1] = y;
  }
  window.addEventListener('pointermove', onMove, { passive: true });

  // Resize.
  function resize() {
    const rect = container.getBoundingClientRect();
    const w = rect.width || container.clientWidth || 800;
    const h = rect.height || container.clientHeight || 600;
    renderer.resize(w, h, dpr);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // rAF loop.
  let raf = 0;
  let running = true;
  const t0 = performance.now();
  function loop(now) {
    if (!running) return;
    // ease mouse toward target — smooth, not jittery
    mouseNdc[0] += (mouseTarget[0] - mouseNdc[0]) * 0.06;
    mouseNdc[1] += (mouseTarget[1] - mouseNdc[1]) * 0.06;
    renderer.render((now - t0) / 1000, mouseNdc);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  _state = {
    mode,
    canvas,
    pause() { running = false; cancelAnimationFrame(raf); },
    resume() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      ro.disconnect();
      if (mode === 'webgl') {
        const gl = renderer.gl;
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
      canvas.remove();
    },
  };
  if (opts.autostart === false) _state.pause();
  return _state;
}

export function pauseParticles()    { _state && _state.pause(); }
export function resumeParticles()   { _state && _state.resume(); }
export function destroyParticles()  { _state && _state.destroy(); }

// =====================================================================
// Optional: manual WebGL probe (used by init.js to order the fallback chain)
// =====================================================================
export function detectBestMode() {
  const c = document.createElement('canvas');
  if (c.getContext('webgl2') || c.getContext('webgl')) return 'webgl';
  if (c.getContext('2d')) return 'canvas2d';
  return 'dom';
}
