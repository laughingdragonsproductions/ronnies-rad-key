/** 2D particle flight: rung click → detail card materialize. */

const COLORS_DEFAULT = ["#22d3ee", "#e879f9", "#fbbf24", "#ffffff"];

let overlayCanvas = null;
let overlayCtx = null;
let rafId = 0;
let activeRun = 0;

function ensureOverlay() {
  if (overlayCanvas?.isConnected) return overlayCanvas;
  overlayCanvas = document.createElement("canvas");
  overlayCanvas.id = "materialize-overlay";
  overlayCanvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(overlayCanvas);
  overlayCtx = overlayCanvas.getContext("2d");
  return overlayCanvas;
}

function resizeOverlay() {
  if (!overlayCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlayCanvas.width = Math.floor(window.innerWidth * dpr);
  overlayCanvas.height = Math.floor(window.innerHeight * dpr);
  overlayCanvas.style.width = `${window.innerWidth}px`;
  overlayCanvas.style.height = `${window.innerHeight}px`;
  if (overlayCtx) overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function pickColor(palette) {
  return palette[Math.floor(Math.random() * palette.length)];
}

export function prefersReducedCardMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * @param {object} opts
 * @param {number} opts.fromX screen px
 * @param {number} opts.fromY screen px
 * @param {DOMRect} opts.toRect card getBoundingClientRect()
 * @param {string[]} [opts.colors]
 * @param {() => void} [opts.onPeak] ~65% — reveal card
 * @param {() => void} [opts.onComplete]
 */
export function materializeCardReveal(opts) {
  const {
    fromX,
    fromY,
    toRect,
    colors = COLORS_DEFAULT,
    onPeak,
    onComplete,
  } = opts;

  const runId = ++activeRun;
  ensureOverlay();
  resizeOverlay();
  overlayCanvas.classList.add("active");

  const targetX = toRect.left + toRect.width / 2;
  const targetY = toRect.top + toRect.height * 0.35;
  const count = window.innerWidth < 640 ? 72 : 120;
  const particles = [];

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 28;
    const rgb = hexToRgb(pickColor(colors));
    particles.push({
      x: fromX + Math.cos(angle) * r,
      y: fromY + Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 1.2,
      vy: (Math.random() - 0.5) * 1.2,
      tx: targetX + (Math.random() - 0.5) * toRect.width * 0.55,
      ty: targetY + (Math.random() - 0.5) * toRect.height * 0.45,
      life: 0.35 + Math.random() * 0.65,
      size: 1.2 + Math.random() * 2.8,
      rgb,
      delay: Math.random() * 0.12,
    });
  }

  const durationMs = 820;
  const peakAt = 0.58;
  let peakFired = false;
  const start = performance.now();

  cancelAnimationFrame(rafId);

  function frame(now) {
    if (runId !== activeRun) return;
    const t = Math.min(1, (now - start) / durationMs);
    const ctx = overlayCtx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    if (t >= peakAt && !peakFired) {
      peakFired = true;
      onPeak?.();
    }

    let alive = 0;
    for (const p of particles) {
      const pt = Math.max(0, (t - p.delay) / (1 - p.delay));
      if (pt <= 0) {
        alive += 1;
        continue;
      }
      const ease = pt * pt * (3 - 2 * pt);
      p.x += (p.tx - p.x) * (0.08 + ease * 0.14);
      p.y += (p.ty - p.y) * (0.08 + ease * 0.14);
      p.x += p.vx * (1 - ease);
      p.y += p.vy * (1 - ease);
      const alpha = p.life * (1 - Math.max(0, (pt - 0.72) / 0.28));
      if (alpha < 0.02) continue;
      alive += 1;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3.5);
      g.addColorStop(0, `rgba(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]},${alpha})`);
      g.addColorStop(0.35, `rgba(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]},${alpha * 0.45})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (t > peakAt) {
      const glow = (t - peakAt) / (1 - peakAt);
      const gx = targetX;
      const gy = targetY;
      const gr = Math.max(toRect.width, toRect.height) * (0.35 + glow * 0.25);
      const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      gg.addColorStop(0, `rgba(251, 191, 36, ${0.22 * (1 - glow * 0.5)})`);
      gg.addColorStop(0.4, `rgba(34, 211, 238, ${0.12 * (1 - glow * 0.6)})`);
      gg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gg;
      ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }

    if (t < 1 || alive > 0) {
      rafId = requestAnimationFrame(frame);
    } else {
      overlayCanvas.classList.remove("active");
      ctx.clearRect(0, 0, w, h);
      onComplete?.();
    }
  }

  rafId = requestAnimationFrame(frame);
}

export function cancelCardMaterialize() {
  activeRun += 1;
  cancelAnimationFrame(rafId);
  if (overlayCanvas) {
    overlayCanvas.classList.remove("active");
    overlayCtx?.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

export function momentAccentColors(moment) {
  if (moment?.category === "music_video" || moment?.strand === "music") {
    return ["#fbbf24", "#fde68a", "#e879f9"];
  }
  if (moment?.category === "legal") {
    return ["#a78bfa", "#e879f9", "#22d3ee"];
  }
  return ["#22d3ee", "#67e8f9", "#fbbf24", "#ffffff"];
}
