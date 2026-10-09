import * as THREE from "three";

/** Soft circle sprite for point particles (avoids square dots). */
function particleTexture() {
  const size = 64;
  const cvs = document.createElement("canvas");
  cvs.width = size;
  cvs.height = size;
  const ctx = cvs.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,0.92)");
  g.addColorStop(0.5, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.needsUpdate = true;
  return tex;
}

let sharedParticleMap = null;
export function getParticleMap() {
  if (!sharedParticleMap) sharedParticleMap = particleTexture();
  return sharedParticleMap;
}

export const particleDriftUniforms = {
  uTime: { value: 0 },
  uAmp: { value: 0.058 },
};

const DRIFT_VERT = `
attribute vec3 color;
attribute float phase;
attribute float wispWeight;
varying vec3 vColor;
uniform float uTime;
uniform float uAmp;
uniform float uPointSize;
void main() {
  vColor = color;
  float spd = mix(0.45, 1.15, wispWeight);
  float amp = uAmp * max(wispWeight, 0.12);
  vec3 pos = position;
  pos.y += sin(uTime * spd + phase) * amp;
  pos.z += cos(uTime * spd * 0.9 + phase * 1.1) * amp * 0.55;
  pos.x += sin(uTime * spd * 0.48 + phase) * amp * 0.2;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float sizeBoost = mix(0.9, 1.55, wispWeight);
  gl_PointSize = uPointSize * sizeBoost * (360.0 / max(-mvPosition.z, 0.001));
  gl_Position = projectionMatrix * mvPosition;
}
`;

const DRIFT_FRAG = `
uniform sampler2D uMap;
varying vec3 vColor;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 lit = vColor * (1.0 + tex.a * 0.65);
  gl_FragColor = vec4(lit, min(tex.a * 1.08, 1.0));
}
`;

function createDriftMaterial(pointSize) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: particleDriftUniforms.uTime,
      uAmp: particleDriftUniforms.uAmp,
      uPointSize: { value: pointSize },
      uMap: { value: getParticleMap() },
    },
    vertexShader: DRIFT_VERT,
    fragmentShader: DRIFT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

let reducedMotionMq = null;
function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  if (!reducedMotionMq) {
    reducedMotionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  }
  return reducedMotionMq.matches;
}

/** Drive GPU drift each frame (helix animate loop). */
export function updateParticleDrift(time, opts = {}) {
  particleDriftUniforms.uTime.value = time;
  const reduced = opts.reducedMotion ?? prefersReducedMotion();
  particleDriftUniforms.uAmp.value = reduced ? 0 : (opts.amp ?? 0.058);
}

function pushParticle(positions, colors, phases, wisps, x, y, z, r, g, b, wispWeight) {
  positions.push(x, y, z);
  colors.push(r, g, b);
  phases.push(Math.random() * Math.PI * 2);
  wisps.push(wispWeight);
}

/**
 * @param {typeof helixPoint} helixPointFn
 * @param {number} phase 0 or PI
 * @param {number} colorHex
 */
export function buildParticleStrand(helixPointFn, phase, colorHex, helixLength, opts = {}) {
  const haloMode = opts.mode === "halo";
  const coreSamples = opts.coreSamples ?? (haloMode ? 220 : 520);
  const wispPerCore = opts.wispPerCore ?? (haloMode ? 4 : 5);
  const positions = [];
  const colors = [];
  const phases = [];
  const wisps = [];
  const core = new THREE.Color(colorHex);
  const halo = core.clone().multiplyScalar(0.78);
  const mist = core.clone().multiplyScalar(0.38);
  const spark = core.clone().lerp(new THREE.Color(0xffffff), 0.35);

  for (let i = 0; i < coreSamples; i++) {
    const x = (i / (coreSamples - 1)) * helixLength - helixLength / 2;
    const p = helixPointFn(x, phase);
    if (!haloMode) {
      pushParticle(positions, colors, phases, wisps, p.x, p.y, p.z, core.r, core.g, core.b, 0.08);
    } else if (Math.random() < 0.55) {
      const tight = 0.04 + Math.random() * 0.07;
      pushParticle(
        positions,
        colors,
        phases,
        wisps,
        p.x + (Math.random() - 0.5) * tight,
        p.y + (Math.random() - 0.5) * tight,
        p.z + (Math.random() - 0.5) * tight,
        spark.r,
        spark.g,
        spark.b,
        0.35 + Math.random() * 0.2
      );
    }

    const wispCount = haloMode ? wispPerCore + 2 : wispPerCore;
    for (let w = 0; w < wispCount; w++) {
      const spread = haloMode ? 0.1 + Math.random() * 0.38 : 0.06 + Math.random() * 0.28;
      pushParticle(
        positions,
        colors,
        phases,
        wisps,
        p.x + (Math.random() - 0.5) * spread,
        p.y + (Math.random() - 0.5) * spread,
        p.z + (Math.random() - 0.5) * spread,
        halo.r,
        halo.g,
        halo.b,
        haloMode ? 0.62 + Math.random() * 0.38 : 0.45 + Math.random() * 0.25
      );
    }

    const mistChance = haloMode ? 0.42 : 0.35;
    if (Math.random() < mistChance) {
      const spread = haloMode ? 0.22 + Math.random() * 0.52 : 0.2 + Math.random() * 0.55;
      pushParticle(
        positions,
        colors,
        phases,
        wisps,
        p.x + (Math.random() - 0.5) * spread,
        p.y + (Math.random() - 0.5) * spread,
        p.z + (Math.random() - 0.5) * spread,
        mist.r,
        mist.g,
        mist.b,
        0.85 + Math.random() * 0.15
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("phase", new THREE.Float32BufferAttribute(phases, 1));
  geo.setAttribute("wispWeight", new THREE.Float32BufferAttribute(wisps, 1));

  const mat = createDriftMaterial(opts.pointSize ?? 0.055);
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 3;
  return points;
}

/** Thin additive halo around a solid rung. */
export function buildParticleRungHalo(from, to, colorHex, scale) {
  const positions = [];
  const colors = [];
  const phases = [];
  const wisps = [];
  const c = new THREE.Color(colorHex);
  const steps = Math.max(8, Math.floor(14 * scale));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    for (let k = 0; k < 2; k++) {
      const spread = 0.06 + Math.random() * 0.12;
      pushParticle(
        positions,
        colors,
        phases,
        wisps,
        x + (Math.random() - 0.5) * spread,
        y + (Math.random() - 0.5) * spread,
        z + (Math.random() - 0.5) * spread,
        c.r * (0.85 + Math.random() * 0.25),
        c.g * (0.85 + Math.random() * 0.25),
        c.b * (0.85 + Math.random() * 0.25),
        0.72 + Math.random() * 0.2
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("phase", new THREE.Float32BufferAttribute(phases, 1));
  geo.setAttribute("wispWeight", new THREE.Float32BufferAttribute(wisps, 1));
  const mat = createDriftMaterial(Math.max(0.048, 0.052 * scale));
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 3;
  return points;
}

export function buildParticleRung(from, to, colorHex, scale) {
  const positions = [];
  const colors = [];
  const phases = [];
  const wisps = [];
  const c = new THREE.Color(colorHex);
  const steps = Math.max(10, Math.floor(18 * scale));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    pushParticle(positions, colors, phases, wisps, x, y, z, c.r, c.g, c.b, 0.15);
    if (Math.random() > 0.5) {
      pushParticle(
        positions,
        colors,
        phases,
        wisps,
        x + (Math.random() - 0.5) * 0.06,
        y + (Math.random() - 0.5) * 0.06,
        z + (Math.random() - 0.5) * 0.06,
        c.r * 0.6,
        c.g * 0.6,
        c.b * 0.6,
        0.55
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("phase", new THREE.Float32BufferAttribute(phases, 1));
  geo.setAttribute("wispWeight", new THREE.Float32BufferAttribute(wisps, 1));
  const mat = createDriftMaterial(0.038 * scale);
  return new THREE.Points(geo, mat);
}

/** Invisible thick pick volume for rung clicks. */
export function buildRungPickProxy(from, to, scale) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const hitR = 0.16 * scale;
  const geo = new THREE.CylinderGeometry(hitR, hitR, len, 8);
  const mat = new THREE.MeshBasicMaterial({
    visible: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return mesh;
}

export function particleDensityForViewport() {
  if (typeof window === "undefined") {
    return { mode: "halo", coreSamples: 300, wispPerCore: 5, pointSize: 0.072 };
  }
  const narrow = window.innerWidth < 640;
  return narrow
    ? { mode: "halo", coreSamples: 220, wispPerCore: 4, pointSize: 0.068 }
    : { mode: "halo", coreSamples: 340, wispPerCore: 6, pointSize: 0.082 };
}
