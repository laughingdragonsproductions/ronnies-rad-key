/** 2D particle flight: rung click → detail card materialize. */

const COLORS_DEFAULT = ["#22d3ee", "#e879f9", "#fbbf24", "#ffffff"];

let overlayCanvas = null;
let overlayCtx = null;
let rafId = 0;
let activeRun = 0;
let detachedRung = null;

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

export function prefersReducedCardMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const TAU = 2 * Math.PI;
const mix = (a, b, t) => a + (b - a) * t;
function ease(start, end, t) {
  const u = Math.max(0, Math.min(1, (t - start) / (end - start)));
  return u * u * (3 - 2 * u);
}

// Each ribbon traces half the perimeter. Both meet at opposite corners.
function edge(rect, u, side) {
  const distance = u * (rect.width + rect.height);
  let x = Math.min(rect.width, distance);
  let y = Math.max(0, distance - rect.width);
  if (side) {
    x = rect.width - x;
    y = rect.height - y;
  }
  return [rect.left + x, rect.top + y];
}

export function materializeCardReveal({ fromX, fromY, rung, toRect, colors = COLORS_DEFAULT, onPeak, onComplete }) {
  cancelCardMaterialize();
  const run = activeRun;
  ensureOverlay();
  resizeOverlay();
  const ctx = overlayCtx;
  if (!ctx) {
    onPeak?.();
    onComplete?.();
    return;
  }
  overlayCanvas.classList.add("active");
  const w = window.innerWidth;
  const h = window.innerHeight;
  const targetX = toRect.left + toRect.width / 2;
  const targetY = toRect.top + toRect.height / 2;
  let start = { x: fromX, y: fromY - 18 };
  let end = { x: fromX, y: fromY + 18 };
  const startTime = performance.now();
  let revealed = false;
  let released = false;
  detachedRung = rung ?? null;

  function frame(now) {
    if (run !== activeRun) return;
    const elapsed = now - startTime;
    const peelMs = rung ? 390 : 0;
    if (rung && !released) {
      const progress = Math.min(1, elapsed / peelMs);
      [start, end] = rung.pose(ease(0, 0.9, progress), ease(0.42, 1, progress));
      if (progress < 1) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      rung.hide();
      released = true;
    }
    const t = Math.min(1, Math.max(0, elapsed - peelMs) / 2050);
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const open = ease(0, 0.36, t);
    const fold = ease(0.38, 0.84, t);
    const travel = ease(0.04, 0.73, t);
    const alpha = 1 - ease(0.83, 1, t);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    for (let side = 0; side < 2; side++) {
      const tint = side ? "#ee9bd0" : "#91e6f5";
      for (let fiber = -3; fiber <= 3; fiber++) {
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const u = i / 96;
          const phase = u * TAU * 1.6 - t * 5 + side * Math.PI;
          const twist = Math.sin(phase);
          const offset = fiber * (0.8 + 2.4 * Math.cos(phase) ** 2);
          const unfurl = ease(0, 0.37, t - 0.055 * (1 - u));
          const x = mix(start.x, end.x, u) + (targetX - centerX) * travel
            + unfurl * Math.min(w * 0.29, 380) * ((u - 0.5) * 1.65 + 0.32 * Math.sin(phase * 2));
          const y = mix(start.y, end.y, u) + (targetY - centerY) * travel
            + unfurl * (Math.min(h * 0.17, 122) * twist + offset);
          const [ex, ey] = edge(toRect, u, side);
          const px = mix(x, ex, fold);
          const py = mix(y, ey, fold);
          if (!i) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
          if (fiber === 2 && i % 2 === 0) {
            const drift = Math.sin(i * 41 + side) * open * (1 - fold * 0.89);
            ctx.fillStyle = tint;
            ctx.globalAlpha = alpha * 0.66;
            ctx.fillRect(px + 18 * drift, py + 13 * drift * Math.cos(i), 1.4, 1.4);
          }
        }
        ctx.globalAlpha = alpha * (fiber === 0 && !side ? 0.88 : open * (fiber === 0 ? 0.88 : 0.25)) / (1 + fold * 2);
        ctx.lineWidth = fiber === 0 ? 1.8 : 1;
        ctx.strokeStyle = fiber === 0 && !side ? colors[0] : tint;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (t >= 0.74 && !revealed) {
      revealed = true;
      onPeak?.();
    }
    if (t < 1) rafId = requestAnimationFrame(frame);
    else {
      overlayCanvas.classList.remove("active");
      onComplete?.();
    }
  }
  rafId = requestAnimationFrame(frame);
}

export function cancelCardMaterialize() {
  detachedRung?.restore();
  detachedRung = null;
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
