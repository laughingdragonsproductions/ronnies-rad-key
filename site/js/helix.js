import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  buildParticleRungHalo,
  buildParticleStrand,
  buildRungPickProxy,
  particleDensityForViewport,
  updateParticleDrift,
} from "./particle-helix.js";
import {
  buildSolidRung,
  buildSolidStrand,
  sampleHelixCurve,
  updateHelixGlassMotion,
} from "./helix-geometry.js";
import { createFlowSystems } from "./particle-flow.js";
import {
  detectQualityTier,
  getQualityTier,
  initQualityListeners,
  prefersReducedMotion,
  watchFrameTime,
} from "./helix-quality.js";

const STRAND_RADIUS = 1.35;
const HELIX_LENGTH = 24;
const TURNS = 2.8;
const PAN_K = 0.42;
const LOOK_K = 0.35;
const CAM_Y_2D = 0.65;
const DIST_2D = 11;
const DIST_3D_DEFAULT = 13;
const DIST_MIN = 6;
const DIST_MAX = 22;
const TILT_3D = 0.42;

/** Timeline runs along X: yearMin on the left (−X), yearMax on the right (+X). */
export function yearToX(year, yearMin, yearMax) {
  const t = (year - yearMin) / (yearMax - yearMin);
  return (t - 0.5) * HELIX_LENGTH;
}

export function progressToX(p) {
  return (p - 0.5) * HELIX_LENGTH;
}

export function helixPoint(x, phase, radius = STRAND_RADIUS) {
  const t = (x + HELIX_LENGTH / 2) / HELIX_LENGTH;
  const angle = t * TURNS * Math.PI * 2 + phase;
  return new THREE.Vector3(
    x,
    Math.cos(angle) * radius,
    Math.sin(angle) * radius
  );
}

function momentYear(m) {
  let y = m.year;
  if (m.month) y += (m.month - 1) / 12;
  if (m.day) y += m.day / 365;
  return y;
}

/** Spread multiple rungs that share a year along the helix axis. */
function computeRungXSpread(moments, yearMin, yearMax) {
  const buckets = new Map();
  for (const m of moments) {
    const key = Math.round(momentYear(m) * 1000);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }
  const spread = new Map();
  const yearSpan = Math.max(1, yearMax - yearMin);
  const maxSpread = (HELIX_LENGTH / yearSpan) * 0.72;
  for (const group of buckets.values()) {
    group.sort((a, b) => (a.id || "").localeCompare(b.id || ""));
    const n = group.length;
    for (let i = 0; i < n; i++) {
      const m = group[i];
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      spread.set(m.id, t * maxSpread);
    }
  }
  return spread;
}

function rungXForMoment(m, yearMin, yearMax, xSpread) {
  const base = yearToX(momentYear(m), yearMin, yearMax);
  return base + (xSpread.get(m.id) || 0);
}

function buildEraBands(eras, yearMin, yearMax, group) {
  for (const era of eras) {
    const x0 = yearToX(era.start, yearMin, yearMax);
    const x1 = yearToX(era.end, yearMin, yearMax);
    const w = Math.max(0.08, Math.abs(x1 - x0));
    const geo = new THREE.BoxGeometry(w, 3.2, 3.2);
    const mat = new THREE.MeshBasicMaterial({
      color: era.color || "#ffffff",
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
    });
    const band = new THREE.Mesh(geo, mat);
    band.position.x = (x0 + x1) / 2;
    group.add(band);
  }
}

function touchDistance(touches) {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

export function createHelix(options) {
  const {
    canvas,
    moments,
    eras = [],
    yearMin,
    yearMax,
    viewMode: initialViewMode = "2d",
    onProgress,
    onSelect,
    onHover,
    onViewModeChange,
  } = options;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);

  const poseGroup = new THREE.Group();
  scene.add(poseGroup);

  const helixGroup = new THREE.Group();
  poseGroup.add(helixGroup);

  let qualityTier = detectQualityTier();

  const strandSampleA = sampleHelixCurve(helixPoint, 0, HELIX_LENGTH, 400);
  const strandSampleB = sampleHelixCurve(helixPoint, Math.PI, HELIX_LENGTH, 400);

  helixGroup.add(buildSolidStrand(strandSampleA.curve, 0x22d3ee));
  helixGroup.add(buildSolidStrand(strandSampleB.curve, 0xe879f9));

  buildEraBands(eras, yearMin, yearMax, helixGroup);

  const density = particleDensityForViewport();
  helixGroup.add(
    buildParticleStrand(helixPoint, 0, 0x22d3ee, HELIX_LENGTH, density)
  );
  helixGroup.add(
    buildParticleStrand(helixPoint, Math.PI, 0xe879f9, HELIX_LENGTH, density)
  );

  const flowSystems = createFlowSystems(helixGroup, strandSampleA, strandSampleB);
  const removeQualityListener = initQualityListeners((tier) => {
    qualityTier = tier;
    flowSystems.rebuildStreams();
  });

  const rungGroup = new THREE.Group();
  helixGroup.add(rungGroup);
  const rungMeshes = [];

  const maxViews = Math.max(
    ...moments.map((m) => m.view_count || 0),
    1
  );
  const xSpread = computeRungXSpread(moments, yearMin, yearMax);

  for (const m of moments) {
    const x = rungXForMoment(m, yearMin, yearMax, xSpread);
    const a = helixPoint(x, 0);
    const b = helixPoint(x, Math.PI);
    const imp = m.importance_score ?? m.importance ?? 0.5;
    const isMusic = m.strand === "music" || m.category === "music_video";
    let viewScale =
      m.view_count && maxViews > 0
        ? 0.7 + 0.8 * (Math.log10(m.view_count) / Math.log10(maxViews))
        : 0.6 + imp * 0.5;
    if (!isMusic) {
      viewScale = Math.max(viewScale, 0.72 + imp * 0.35);
    }
    const color =
      m.strand === "music" || m.category === "music_video"
        ? 0xfbbf24
        : m.category === "legal"
          ? 0xa78bfa
          : 0x67e8f9;
    const wrap = new THREE.Group();
    wrap.add(buildSolidRung(a, b, color, viewScale));
    wrap.add(buildParticleRungHalo(a, b, color, viewScale));
    const pick = buildRungPickProxy(a, b, viewScale);
    pick.userData.moment = m;
    pick.userData.wrap = wrap;
    wrap.add(pick);
    wrap.userData.moment = m;
    rungGroup.add(wrap);
    rungMeshes.push(pick);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const lookTarget = new THREE.Vector3();

  let hovered = null;
  let scrubDrag = false;
  let orbitDrag = false;
  let panDrag = false;
  let corkscrewDrag = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let targetPanX = 0;
  let targetPanY = 0;
  let panX = 0;
  let panY = 0;
  /** Twist around timeline axis (X) — opens rungs hidden in the helix curve. */
  let targetHelixRoll = 0.35;
  let helixRoll = 0.35;
  let pinchStartDist = 0;
  let pinchStartZoom = DIST_3D_DEFAULT;

  let viewMode = initialViewMode === "3d" ? "3d" : "2d";
  let progress = 0.35;
  let targetProgress = progress;
  /** Camera center along helix (0 = yearMin end, 1 = yearMax end); independent of Rad Key scrub. */
  let focusProgress = 1;
  let targetFocusProgress = 1;

  let orbitYaw = -0.35;
  let orbitPitch = 0.08;
  let targetOrbitYaw = orbitYaw;
  let targetOrbitPitch = orbitPitch;

  let cameraDistance = viewMode === "3d" ? DIST_3D_DEFAULT : DIST_2D;
  let targetCameraDistance = cameraDistance;

  function setProgress(p, { emit = true } = {}) {
    targetProgress = THREE.MathUtils.clamp(p, 0, 1);
    if (emit && onProgress) {
      const year = yearMin + targetProgress * (yearMax - yearMin);
      onProgress(targetProgress, year);
    }
  }

  function setFocusProgress(p) {
    targetFocusProgress = THREE.MathUtils.clamp(p, 0, 1);
  }

  function applyPoseForMode() {
    if (viewMode === "2d") {
      poseGroup.rotation.set(0, 0, 0);
      targetCameraDistance = DIST_2D;
    } else {
      targetCameraDistance = THREE.MathUtils.clamp(
        targetCameraDistance,
        DIST_MIN,
        DIST_MAX
      );
    }
  }

  function setViewMode(mode) {
    const next = mode === "3d" ? "3d" : "2d";
    if (next === viewMode) return;
    viewMode = next;
    applyPoseForMode();
    if (viewMode === "2d") {
      targetOrbitYaw = 0;
      targetOrbitPitch = 0;
    }
    onViewModeChange?.(viewMode);
  }

  function getViewMode() {
    return viewMode;
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
  }

  function updatePointer(ev) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pick(ev) {
    updatePointer(ev);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(rungMeshes, false);
    return hits[0]?.object ?? null;
  }

  const _screenProj = new THREE.Vector3();

  /** Screen coordinates for a rung pick mesh (center of rung). */
  function rungScreenPoint(obj) {
    if (!obj) return null;
    obj.getWorldPosition(_screenProj);
    _screenProj.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (_screenProj.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-_screenProj.y * 0.5 + 0.5) * rect.height,
    };
  }

  canvas.addEventListener("pointermove", (ev) => {
    if (panDrag) {
      const dx = ev.clientX - lastPointerX;
      const dy = ev.clientY - lastPointerY;
      lastPointerX = ev.clientX;
      lastPointerY = ev.clientY;
      targetPanX += dx * 0.022;
      targetPanY -= dy * 0.018;
      return;
    }

    if (corkscrewDrag) {
      const dx = ev.clientX - lastPointerX;
      const dy = ev.clientY - lastPointerY;
      lastPointerX = ev.clientX;
      lastPointerY = ev.clientY;
      targetHelixRoll += dy * -0.006 + dx * 0.004;
      return;
    }

    if (orbitDrag && viewMode === "3d") {
      const dx = ev.clientX - lastPointerX;
      const dy = ev.clientY - lastPointerY;
      lastPointerX = ev.clientX;
      lastPointerY = ev.clientY;
      targetOrbitYaw += dx * 0.006;
      targetOrbitPitch = THREE.MathUtils.clamp(
        targetOrbitPitch - dy * 0.004,
        -0.35,
        0.45
      );
      return;
    }

    if (scrubDrag && viewMode === "2d") {
      const dx = ev.clientX - lastPointerX;
      lastPointerX = ev.clientX;
      setProgress(targetProgress + dx * 0.0025);
      return;
    }

    const obj = pick(ev);
    if (hovered && hovered !== obj) {
      hovered.userData.wrap?.scale.set(1, 1, 1);
      onHover?.(null);
    }
    hovered = obj;
    if (obj) {
      obj.userData.wrap?.scale.set(1.12, 1.15, 1.12);
      onHover?.(obj.userData.moment);
      canvas.style.cursor = "pointer";
    } else if (!scrubDrag && !orbitDrag) {
      canvas.style.cursor = viewMode === "3d" ? "grab" : "grab";
    }
  });

  canvas.addEventListener(
    "mousedown",
    (ev) => {
      if (ev.button === 1) ev.preventDefault();
    },
    { passive: false }
  );

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "touch" && ev.isPrimary === false) return;

    const obj = pick(ev);
    if (obj) {
      const m = obj.userData.moment;
      const my = momentYear(m);
      const p = (my - yearMin) / (yearMax - yearMin);
      flowSystems.burstAtHelixX(progressToX(p), 18);
      onSelect?.(m, { origin: rungScreenPoint(obj) });
      setProgress(p);
      return;
    }

    const panMode = ev.shiftKey || ev.button === 1;
    const corkscrewMode = ev.altKey && !panMode;
    if (corkscrewMode) {
      corkscrewDrag = true;
      lastPointerX = ev.clientX;
      lastPointerY = ev.clientY;
    } else if (panMode) {
      panDrag = true;
      lastPointerX = ev.clientX;
      lastPointerY = ev.clientY;
    } else if (viewMode === "3d") {
      orbitDrag = true;
      lastPointerX = ev.clientX;
      lastPointerY = ev.clientY;
    } else {
      scrubDrag = true;
      lastPointerX = ev.clientX;
    }
    canvas.setPointerCapture(ev.pointerId);
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointerup", (ev) => {
    scrubDrag = false;
    orbitDrag = false;
    panDrag = false;
    corkscrewDrag = false;
    canvas.style.cursor = "grab";
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  });

  canvas.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      if (ev.altKey) {
        targetHelixRoll += ev.deltaY * 0.0025;
        return;
      }
      if (viewMode === "3d" && !ev.shiftKey) {
        targetCameraDistance = THREE.MathUtils.clamp(
          targetCameraDistance + ev.deltaY * 0.012,
          DIST_MIN,
          DIST_MAX
        );
        return;
      }
      const delta =
        (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) *
        0.0008;
      setProgress(targetProgress + delta);
    },
    { passive: false }
  );

  canvas.addEventListener(
    "touchstart",
    (ev) => {
      if (viewMode !== "3d" || ev.touches.length < 2) return;
      pinchStartDist = touchDistance(ev.touches);
      pinchStartZoom = targetCameraDistance;
    },
    { passive: true }
  );

  canvas.addEventListener(
    "touchmove",
    (ev) => {
      if (viewMode !== "3d" || ev.touches.length < 2 || !pinchStartDist) return;
      const dist = touchDistance(ev.touches);
      const scale = pinchStartDist / dist;
      targetCameraDistance = THREE.MathUtils.clamp(
        pinchStartZoom * scale,
        DIST_MIN,
        DIST_MAX
      );
    },
    { passive: true }
  );

  canvas.addEventListener(
    "touchend",
    () => {
      pinchStartDist = 0;
    },
    { passive: true }
  );

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1),
    0.48,
    0.4,
    0.24
  );
  composer.addPass(bloomPass);

  let rafId = 0;
  let disposed = false;
  let time = 0;
  let lastFrameMs = performance.now();
  let lastProgressForTrail = progress;
  let progressVelocity = 0;
  let animationPaused = false;

  canvas.addEventListener(
    "webglcontextlost",
    (ev) => {
      ev.preventDefault();
      animationPaused = true;
      cancelAnimationFrame(rafId);
    },
    false
  );

  canvas.addEventListener(
    "webglcontextrestored",
    () => {
      animationPaused = false;
      animate();
    },
    false
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) lastFrameMs = performance.now();
  });

  function updateCamera() {
    progress += (targetProgress - progress) * 0.08;
    focusProgress += (targetFocusProgress - focusProgress) * 0.1;
    cameraDistance += (targetCameraDistance - cameraDistance) * 0.1;
    orbitYaw += (targetOrbitYaw - orbitYaw) * 0.12;
    orbitPitch += (targetOrbitPitch - orbitPitch) * 0.12;
    panX += (targetPanX - panX) * 0.14;
    panY += (targetPanY - panY) * 0.14;
    helixRoll += (targetHelixRoll - helixRoll) * 0.12;
    helixGroup.rotation.x = helixRoll;

    const focusX = progressToX(focusProgress);
    lookTarget.set(focusX * LOOK_K + panX, panY * 0.55, 0);

    if (viewMode === "2d") {
      poseGroup.rotation.set(0, 0, 0);
      poseGroup.position.set(panX, panY, 0);
      camera.position.set(focusX * PAN_K + panX * 0.35, CAM_Y_2D + panY, cameraDistance);
      camera.lookAt(lookTarget);
      return;
    }

    poseGroup.rotation.order = "YXZ";
    poseGroup.rotation.set(TILT_3D + orbitPitch, orbitYaw, 0);
    poseGroup.position.set(panX, panY, 0);
    camera.position.set(focusX * PAN_K + panX * 0.35, CAM_Y_2D + 0.15 + panY, cameraDistance);
    camera.lookAt(lookTarget);
  }

  function animate() {
    if (disposed || animationPaused) return;
    rafId = requestAnimationFrame(animate);
    const now = performance.now();
    const dtMs = Math.min(now - lastFrameMs, 50);
    lastFrameMs = now;
    const dt = dtMs / 1000;
    time += dt;

    if (watchFrameTime(dtMs)) {
      flowSystems.rebuildStreams();
    }
    qualityTier = getQualityTier();
    const reduced = prefersReducedMotion();

    updateParticleDrift(time, { reducedMotion: reduced });
    updateHelixGlassMotion(time, { reducedMotion: reduced, tier: qualityTier });
    updateCamera();

    const prevP = lastProgressForTrail;
    progressVelocity = (progress - prevP) / Math.max(dt, 1e-4);
    lastProgressForTrail = progress;

    flowSystems.update(dt, {
      reducedMotion: reduced,
      tier: qualityTier,
      documentHidden: document.hidden,
      scrubActive: scrubDrag,
      progressVelocity,
      progressX: progressToX(progress),
    });

    composer.render();
  }

  resize();
  const onResize = () => resize();
  window.addEventListener("resize", onResize);
  applyPoseForMode();
  animate();

  return {
    setProgress(p, opts) {
      setProgress(p, opts);
    },
    getProgress: () => targetProgress,
    setFocusProgress,
    getFocusProgress: () => targetFocusProgress,
    setViewMode,
    getViewMode,
    focusMoment(id) {
      const m = moments.find((x) => x.id === id);
      if (!m) return;
      const my = momentYear(m);
      setProgress((my - yearMin) / (yearMax - yearMin));
      onSelect?.(m);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      removeQualityListener?.();
      flowSystems.dispose();
      helixGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      composer.dispose();
      renderer.dispose();
    },
  };
}

export function detectWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(
      c.getContext("webgl") || c.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}
