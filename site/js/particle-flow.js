import * as THREE from "three";
import { getParticleMap, particleDriftUniforms } from "./particle-helix.js";
import {
  getQualityTier,
  maxTrailSpawnsPerFrame,
  streamParticleCapForTier,
  trailEnabledForTier,
} from "./helix-quality.js";

const STREAM_VERT = `
attribute vec3 color;
attribute float phase;
attribute float along;
attribute float wispWeight;
varying vec3 vColor;
uniform float uTime;
uniform float uAmp;
uniform float uPointSize;
void main() {
  vColor = color;
  float spd = mix(0.5, 1.1, wispWeight);
  float amp = uAmp * max(wispWeight, 0.15);
  vec3 pos = position;
  pos.y += sin(uTime * spd + phase) * amp * 0.35;
  pos.z += cos(uTime * spd * 0.85 + phase) * amp * 0.25;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float stretch = 1.0 + along * 0.55;
  float sizeBoost = mix(1.0, 1.4, wispWeight);
  gl_PointSize = uPointSize * stretch * sizeBoost * (360.0 / max(-mvPosition.z, 0.001));
  gl_Position = projectionMatrix * mvPosition;
}
`;

const STREAM_FRAG = `
uniform sampler2D uMap;
varying vec3 vColor;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 lit = vColor * (1.0 + tex.a * 0.75);
  gl_FragColor = vec4(lit, min(tex.a * 1.05, 1.0));
}
`;

const TRAIL_VERT = `
attribute vec3 color;
attribute float life;
varying vec3 vColor;
varying float vLife;
uniform float uPointSize;
void main() {
  vColor = color;
  vLife = life;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPointSize * life * (340.0 / max(-mvPosition.z, 0.001));
  gl_Position = projectionMatrix * mvPosition;
}
`;

const TRAIL_FRAG = `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vLife;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 lit = vColor * (1.0 + tex.a * 0.5);
  gl_FragColor = vec4(lit, tex.a * vLife * 0.95);
}
`;

function createStreamMaterial(pointSize) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: particleDriftUniforms.uTime,
      uAmp: particleDriftUniforms.uAmp,
      uPointSize: { value: pointSize },
      uMap: { value: getParticleMap() },
    },
    vertexShader: STREAM_VERT,
    fragmentShader: STREAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function createTrailMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPointSize: { value: 0.16 },
      uMap: { value: getParticleMap() },
    },
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function buildStreamSystem(curve, colorHex, count) {
  if (!count || !curve) return null;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const alongAttr = new Float32Array(count);
  const wisps = new Float32Array(count);
  const alongState = new Float32Array(count);
  const speeds = new Float32Array(count);

  const base = new THREE.Color(colorHex);
  const warm = base.clone().lerp(new THREE.Color(0xfbbf24), 0.35);

  for (let i = 0; i < count; i++) {
    alongState[i] = Math.random();
    speeds[i] = 0.05 + Math.random() * 0.09;
    phases[i] = Math.random() * Math.PI * 2;
    wisps[i] = 0.4 + Math.random() * 0.5;
    alongAttr[i] = alongState[i];
    const t = alongState[i];
    const p = curve.getPointAt(t);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    const c = warm.clone().lerp(base, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
  geo.setAttribute("along", new THREE.BufferAttribute(alongAttr, 1));
  geo.setAttribute("wispWeight", new THREE.BufferAttribute(wisps, 1));

  const points = new THREE.Points(geo, createStreamMaterial(0.078));
  points.frustumCulled = false;
  points.renderOrder = 4;

  return {
    points,
    curve,
    alongState,
    speeds,
    count,
    enabled: true,
  };
}

class TrailPool {
  constructor(max = 256) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.lives = new Float32Array(max);
    this.vel = [];
    this.head = 0;
    for (let i = 0; i < max; i++) this.vel.push(new THREE.Vector3());

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute("life", new THREE.BufferAttribute(this.lives, 1));
    this.points = new THREE.Points(geo, createTrailMaterial());
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  spawn(x, y, z, vx, vy, vz, colorHex) {
    const i = this.head % this.max;
    this.head += 1;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    const c = new THREE.Color(colorHex);
    this.colors[i * 3] = c.r;
    this.colors[i * 3 + 1] = c.g;
    this.colors[i * 3 + 2] = c.b;
    this.lives[i] = 1;
    this.vel[i].set(vx, vy, vz);
  }

  update(dt) {
    const drag = 0.92;
    for (let i = 0; i < this.max; i++) {
      if (this.lives[i] <= 0) continue;
      this.lives[i] -= dt * 1.4;
      this.positions[i * 3] += this.vel[i].x * dt;
      this.positions[i * 3 + 1] += this.vel[i].y * dt;
      this.positions[i * 3 + 2] += this.vel[i].z * dt;
      this.vel[i].multiplyScalar(drag);
      this.vel[i].y -= dt * 0.15;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.life.needsUpdate = true;
  }
}

/**
 * @param {THREE.Group} parent helixGroup
 * @param {{ curve: THREE.Curve }} strandA
 * @param {{ curve: THREE.Curve }} strandB
 */
export function createFlowSystems(parent, strandA, strandB) {
  const trail = new TrailPool(320);
  parent.add(trail.points);

  let streamA = null;
  let streamB = null;

  function rebuildStreams() {
    if (streamA?.points) parent.remove(streamA.points);
    if (streamB?.points) parent.remove(streamB.points);
    streamA?.points?.geometry?.dispose();
    streamB?.points?.geometry?.dispose();
    streamA?.points?.material?.dispose();
    streamB?.points?.material?.dispose();

    const cap = streamParticleCapForTier(getQualityTier());
    const half = Math.floor(cap / 2);
    streamA = buildStreamSystem(strandA?.curve, 0x22d3ee, half);
    streamB = buildStreamSystem(strandB?.curve, 0xe879f9, cap - half);
    if (streamA?.points) parent.add(streamA.points);
    if (streamB?.points) parent.add(streamB.points);
  }

  rebuildStreams();

  const tmp = new THREE.Vector3();

  function updateStream(sys, dt) {
    if (!sys?.enabled || !sys.points.visible) return;
    const pos = sys.points.geometry.attributes.position.array;
    const alongAttr = sys.points.geometry.attributes.along.array;
    for (let i = 0; i < sys.count; i++) {
      sys.alongState[i] += sys.speeds[i] * dt;
      if (sys.alongState[i] > 1) sys.alongState[i] -= 1;
      alongAttr[i] = sys.alongState[i];
      sys.curve.getPointAt(sys.alongState[i], tmp);
      pos[i * 3] = tmp.x;
      pos[i * 3 + 1] = tmp.y;
      pos[i * 3 + 2] = tmp.z;
    }
    sys.points.geometry.attributes.position.needsUpdate = true;
    sys.points.geometry.attributes.along.needsUpdate = true;
  }

  let spawnsThisFrame = 0;

  function burstAtHelixX(x, n = 14) {
    const colors = [0xfbbf24, 0x22d3ee, 0xe879f9, 0xffffff];
    for (let i = 0; i < n; i++) {
      trail.spawn(
        x + (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.35 - 0.1,
        (Math.random() - 0.5) * 0.35,
        colors[Math.floor(Math.random() * colors.length)]
      );
    }
  }

  return {
    trail,
    rebuildStreams,
    burstAtHelixX,
    update(dt, ctx) {
      spawnsThisFrame = 0;
      const cappedDt = Math.min(dt, 0.05);
      const paused = ctx.documentHidden ?? false;
      const reduced = ctx.reducedMotion ?? false;
      const tier = ctx.tier ?? getQualityTier();

      const streamsOn = !reduced && tier !== "low" && !paused;
      if (streamA) streamA.points.visible = streamsOn;
      if (streamB) streamB.points.visible = streamsOn;

      if (streamsOn) {
        updateStream(streamA, cappedDt);
        updateStream(streamB, cappedDt);
      }

      trail.points.visible = !reduced && trailEnabledForTier(tier);
      if (trail.points.visible && !paused) {
        trail.update(cappedDt);
      }

      const maxSpawn = maxTrailSpawnsPerFrame(tier);
      const wantTrail =
        ctx.scrubActive ||
        Math.abs(ctx.progressVelocity ?? 0) > 0.0008;
      if (
        wantTrail &&
        trail.points.visible &&
        maxSpawn > 0
      ) {
        const x = ctx.progressX ?? 0;
        const sign = Math.sign(ctx.progressVelocity || 1);
        const colors = [0xfbbf24, 0x22d3ee, 0xe879f9];
        const bursts = ctx.scrubActive ? 3 : 1;
        for (let b = 0; b < bursts; b++) {
          if (spawnsThisFrame >= maxSpawn) break;
          const col = colors[Math.floor(Math.random() * colors.length)];
          trail.spawn(
            x + (Math.random() - 0.5) * 0.15,
            (Math.random() - 0.5) * 0.35 - 0.25,
            (Math.random() - 0.5) * 0.35,
            sign * (0.8 + Math.random() * 1.2),
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.2,
            col
          );
          spawnsThisFrame += 1;
        }
      }
    },
    dispose() {
      if (streamA?.points) {
        parent.remove(streamA.points);
        streamA.points.geometry.dispose();
        streamA.points.material.dispose();
      }
      if (streamB?.points) {
        parent.remove(streamB.points);
        streamB.points.geometry.dispose();
        streamB.points.material.dispose();
      }
      parent.remove(trail.points);
      trail.points.geometry.dispose();
      trail.points.material.dispose();
    },
  };
}
