// prefers-reduced-motion.js — global reduced-motion guard for v6-particle-motion.
// Sets a global flag window.__prefersReducedMotion that other modules respect.
// Also lists the media query — no other module should call matchMedia directly.
//
// Usage: import as the FIRST module in your page (before particles.js, motion-interactions.js).
//   <script type="module">
//     import './assets/prefers-reduced-motion.js';
//     import { initParticles } from './assets/particles.js';
//     import { initMotion } from './assets/motion-interactions.js';
//     ...
//   </script>

const mq = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

let reduced = !!(mq && mq.matches);

// Set before any other module reads it.
window.__prefersReducedMotion = reduced;

if (mq) {
  // Listener API: Safari 14+, modern Chrome/Firefox. addEventListener is the
  // modern path; addListener is the legacy fallback (Chrome 10-79).
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', (e) => {
      window.__prefersReducedMotion = !!e.matches;
      document.documentElement.dataset.reducedMotion = e.matches ? 'reduce' : 'no-preference';
      // Soft event for any module that wants to react live.
      window.dispatchEvent(new CustomEvent('reduced-motion-changed', { detail: { reduced: !!e.matches } }));
    });
  } else if (typeof mq.addListener === 'function') {
    mq.addListener((e) => {
      window.__prefersReducedMotion = !!e.matches;
      document.documentElement.dataset.reducedMotion = e.matches ? 'reduce' : 'no-preference';
      window.dispatchEvent(new CustomEvent('reduced-motion-changed', { detail: { reduced: !!e.matches } }));
    });
  }
}

// Mirror to <html data-reduced-motion="..."> for pure-CSS hooks.
// CSS can use: html[data-reduced-motion="reduce"] * { animation: none !important; transition: none !important; }
document.documentElement.dataset.reducedMotion = reduced ? 'reduce' : 'no-preference';

export function prefersReducedMotion() {
  return window.__prefersReducedMotion === true;
}

// Exported for testing in headless/self-test contexts.
export const _mq = mq;
