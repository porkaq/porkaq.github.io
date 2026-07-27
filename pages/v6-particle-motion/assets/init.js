// init.js — v6-particle-motion bootstrap.
// Order of operations:
//   1. prefers-reduced-motion.js  (sets global flag first)
//   2. particles.js (WebGL → Canvas → DOM fallback)
//   3. motion-interactions.js (mouse, parallax, reveal)
// Logs the chosen mode to console.info for self-test verification.
//
// Usage:
//   <script type="module" src="./assets/init.js"></script>
// The script reads `data-` attributes from the canvas and container to vary behavior.
//   <canvas data-particles-canvas data-particle-density="medium"></canvas>
//   <div data-magnetic="strong" class="cta-magnetic">...</div>
//   <div data-parallax="0.4">...</div>
//   <section data-reveal="fade-up">...</section>

import { initParticles, pauseParticles, resumeParticles, detectBestMode } from './particles.js';
import { initMotion, getFps } from './motion-interactions.js';

// Touch the prefers-reduced-motion module so its side-effects (setting window.__prefersReducedMotion)
// and document.documentElement.dataset.reducedMotion run regardless of how the user loads us.
// If the user forgot to add prefers-reduced-motion.js to the page, that's fine — particles.js
// and motion-interactions.js both default to "no preference" when the flag is undefined.
import('./prefers-reduced-motion.js').catch(() => {
  // not fatal — flags stay at default false
});

function setupForReducedMotion() {
  if (!window.__prefersReducedMotion) return;
  // Belt-and-suspenders: disable any CSS animations on hero chrome.
  const style = document.createElement('style');
  style.textContent = `
    @media (prefers-reduced-motion: reduce) {
      html[data-reduced-motion="reduce"] * {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    return;
  }

  setupForReducedMotion();

  const container = document.querySelector('[data-particles]') || document.querySelector('main');
  const particles = initParticles({ container });
  const motion = initMotion();

  // Console banner for self-test verification.
  const reduced = !!window.__prefersReducedMotion;
  const mode = detectBestMode();
  console.info('[v6-runtime] mode=', mode, 'particles=', particles.mode, 'reduced-motion=', reduced);

  // Expose for self-test probes.
  window.__v6Runtime = {
    mode, particles: particles.mode, reduced,
    fps: () => getFps(),
    pauseParticles, resumeParticles,
    destroy: () => { particles.destroy(); motion.destroy(); },
  };

  // Soft autostart pause on tab hidden (save battery on mobile).
  let wasHidden = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !wasHidden) {
      wasHidden = true;
      particles.pause();
    } else if (!document.hidden && wasHidden) {
      wasHidden = false;
      particles.resume();
    }
  });
}

boot();
