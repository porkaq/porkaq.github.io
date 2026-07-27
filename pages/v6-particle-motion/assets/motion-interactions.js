// motion-interactions.js — v6-particle-motion runtime interactions
// Mouse-tracking magnetic CTA, scroll parallax for hero visuals, IntersectionObserver
// reveal for cards. All vanilla, ES module, no deps. ~3 KB minified.
//
// Honors prefers-reduced-motion: if window.__prefersReducedMotion is true,
// every module is a no-op except reveal (which fires immediately).
//
// Usage:
//   <a class="cta-magnetic" data-magnetic="strong">Contact</a>
//   <div data-parallax="0.4">...hero visual...</div>
//   <section class="reveal-fade">...</section>
//   <script type="module">
//     import { initMotion } from './assets/motion-interactions.js';
//     initMotion();
//   </script>

const MAGNETIC_ATTR = '[data-magnetic]';
const PARALLAX_ATTR  = '[data-parallax]';
const REVEAL_ATTR    = '[data-reveal]';

// Rough fps monitor — exposed via window.__fps for self-test.
let _fps = 0;
let _frameAcc = 0;
let _frameLast = 0;
let _frameCount = 0;

function isReduced() {
  return !!window.__prefersReducedMotion;
}

// =====================================================================
// Magnetic CTA — cursor pulls the element gently toward itself.
// Strengh: 'soft' (4px max), 'medium' (10px), 'strong' (18px).
// =====================================================================
function initMagnetic(root = document) {
  if (isReduced()) return [];
  const els = Array.from(root.querySelectorAll(MAGNETIC_ATTR));
  const items = els.map((el) => {
    const strength = (el.dataset.magnetic || 'medium').toLowerCase();
    const max = strength === 'soft' ? 4 : strength === 'strong' ? 18 : 10;
    let tx = 0, ty = 0;       // current offset
    let txT = 0, tyT = 0;     // target offset
    let raf = 0;
    let active = false;
    function onMove(e) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      txT = Math.max(-max, Math.min(max, (e.clientX - cx) * 0.35));
      tyT = Math.max(-max, Math.min(max, (e.clientY - cy) * 0.35));
    }
    function onLeave() {
      txT = 0; tyT = 0;
    }
    function tick() {
      tx += (txT - tx) * 0.18;
      ty += (tyT - ty) * 0.18;
      // Use translate3d to keep GPU compositing.
      el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
      if (Math.abs(tx - txT) > 0.05 || Math.abs(ty - tyT) > 0.05) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    }
    function ensureTick() {
      if (!raf) raf = requestAnimationFrame(tick);
    }
    el.addEventListener('pointermove', (e) => { onMove(e); ensureTick(); });
    el.addEventListener('pointerleave', () => { onLeave(); ensureTick(); });
    el.addEventListener('pointerenter', ensureTick);
    return {
      el,
      destroy() {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerleave', onLeave);
        cancelAnimationFrame(raf);
        el.style.transform = '';
      },
    };
  });
  return items;
}

// =====================================================================
// Scroll parallax — translate elements vertically based on scroll position.
// data-parallax value: -1..1, where 0.3 = element moves 30% slower than scroll.
// =====================================================================
function initParallax(root = document) {
  if (isReduced()) return [];
  const els = Array.from(root.querySelectorAll(PARALLAX_ATTR)).map((el) => {
    const factor = parseFloat(el.dataset.parallax) || 0.3;
    let raf = 0;
    let pending = false;
    function apply() {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      // -1 when element is at bottom of viewport, +1 when at top.
      const progress = (vh - r.top) / (vh + r.height);
      const offset = (progress - 0.5) * factor * 100; // pixels
      el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
      pending = false;
    }
    function onScroll() {
      if (pending) return;
      pending = true;
      raf = requestAnimationFrame(apply);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    apply();
    return {
      el,
      destroy() {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        cancelAnimationFrame(raf);
        el.style.transform = '';
      },
    };
  });
  return els;
}

// =====================================================================
// Scroll-reveal — IntersectionObserver toggles .is-visible on elements.
// data-reveal value: 'fade', 'fade-up', 'fade-x', 'scale' (default: fade-up).
// =====================================================================
function initReveal(root = document) {
  const els = Array.from(root.querySelectorAll(REVEAL_ATTR));
  if (!els.length) return [];

  // If no IO (very old browser) or reduced-motion, just show everything.
  if (isReduced() || typeof IntersectionObserver === 'undefined') {
    els.forEach((el) => el.classList.add('is-visible'));
    return els.map((el) => ({ el, destroy() {} }));
  }

  const variant = (el) => el.dataset.reveal || 'fade-up';
  els.forEach((el) => el.classList.add('reveal-' + variant(el)));

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });

  els.forEach((el) => io.observe(el));
  return els.map((el) => ({
    el,
    destroy() { io.unobserve(el); },
  }));
}

// =====================================================================
// FPS monitor — for self-test only. No production cost beyond 1 innerText
// write per second.
// =====================================================================
function startFpsMonitor() {
  const el = document.querySelector('[data-fps]');
  if (!el) return () => {};
  _frameLast = performance.now();
  function tick(now) {
    const dt = now - _frameLast;
    _frameLast = now;
    if (dt > 0) {
      _frameAcc += dt;
      _frameCount++;
      if (_frameAcc >= 1000) {
        _fps = Math.round((_frameCount / _frameAcc) * 1000);
        el.textContent = String(_fps);
        _frameAcc = 0;
        _frameCount = 0;
      }
    }
    requestAnimationFrame(tick);
  }
  const id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

// =====================================================================
// Public init
// =====================================================================
export function initMotion(opts = {}) {
  const root = opts.root || document;
  const handles = [
    ...initMagnetic(root),
    ...initParallax(root),
    ...initReveal(root),
  ];
  const stopFps = (opts.monitorFps !== false) ? startFpsMonitor() : () => {};
  return {
    handles,
    destroy() {
      handles.forEach((h) => h.destroy && h.destroy());
      stopFps();
    },
    fps: () => _fps,
  };
}

export function getFps() { return _fps; }
