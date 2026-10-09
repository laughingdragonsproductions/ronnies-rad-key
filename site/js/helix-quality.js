/** Quality tiers for helix VFX (flow, streams, trail). */

const TIER_ORDER = ["high", "medium", "low"];

let activeTier = "high";
let frameEmaMs = 16;
let slowFrameStreak = 0;
let reducedMotionMq = null;

function getReducedMotionMq() {
  if (typeof window === "undefined") return null;
  if (!reducedMotionMq) {
    reducedMotionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  }
  return reducedMotionMq;
}

export function prefersReducedMotion() {
  return getReducedMotionMq()?.matches ?? false;
}

export function detectQualityTier() {
  if (typeof window === "undefined") return "high";
  if (prefersReducedMotion()) return "low";
  const narrow = window.innerWidth < 640;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (narrow || cores <= 4) return "medium";
  return "high";
}

export function getQualityTier() {
  return activeTier;
}

export function setQualityTier(tier) {
  if (TIER_ORDER.includes(tier)) activeTier = tier;
}

export function degradeQualityTier() {
  const idx = TIER_ORDER.indexOf(activeTier);
  if (idx < TIER_ORDER.length - 1) {
    activeTier = TIER_ORDER[idx + 1];
    slowFrameStreak = 0;
  }
}

/**
 * Rolling frame-time watchdog; returns true if tier was degraded this frame.
 * @param {number} dtMs frame delta in ms
 */
export function watchFrameTime(dtMs, opts = {}) {
  const thresholdMs = opts.thresholdMs ?? 22;
  const streakNeeded = opts.streakNeeded ?? 120;
  frameEmaMs = frameEmaMs * 0.92 + dtMs * 0.08;
  if (frameEmaMs > thresholdMs && activeTier !== "low") {
    slowFrameStreak += 1;
    if (slowFrameStreak >= streakNeeded) {
      degradeQualityTier();
      return true;
    }
  } else {
    slowFrameStreak = Math.max(0, slowFrameStreak - 1);
  }
  return false;
}

export function streamParticleCapForTier(tier = activeTier) {
  if (tier === "low") return 0;
  if (tier === "medium") return 900;
  return 2800;
}

export function trailEnabledForTier(tier = activeTier) {
  return tier === "high" || tier === "medium";
}

export function maxTrailSpawnsPerFrame(tier = activeTier) {
  if (tier === "high") return 8;
  if (tier === "medium") return 4;
  return 0;
}

export function initQualityListeners(onChange) {
  const mq = getReducedMotionMq();
  if (!mq || typeof onChange !== "function") return () => {};
  const handler = () => {
    activeTier = detectQualityTier();
    onChange(activeTier);
  };
  mq.addEventListener("change", handler);
  activeTier = detectQualityTier();
  return () => mq.removeEventListener("change", handler);
}
