import * as THREE from "three";

/** Shared motion uniforms for glass strand flow shader. */
export const helixGlassUniforms = {
  uTime: { value: 0 },
  uFlowSpeed: { value: 0.35 },
  uFlowRepeat: { value: 14 },
  uFlowStrength: { value: 0.55 },
};

const GLASS_VERT = `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const GLASS_FRAG = `
uniform vec3 uBaseColor;
uniform float uTime;
uniform float uFlowSpeed;
uniform float uFlowRepeat;
uniform float uFlowStrength;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float fresnel = pow(1.0 - max(dot(normalize(vNormalW), normalize(vViewDir)), 0.0), 2.2);
  float along = vUv.y;
  float band = fract(along * uFlowRepeat - uTime * uFlowSpeed);
  float pulse = smoothstep(0.0, 0.12, band) * (1.0 - smoothstep(0.22, 0.45, band));
  pulse += smoothstep(0.55, 0.68, band) * (1.0 - smoothstep(0.72, 0.88, band)) * 0.45;
  float n = hash(vec2(along * 40.0, uTime * 0.2)) * 0.08;
  vec3 emissive = uBaseColor * (0.55 + fresnel * 0.85 + pulse * uFlowStrength + n);
  float alpha = uOpacity * (0.72 + fresnel * 0.28);
  gl_FragColor = vec4(emissive, alpha);
}
`;

let sharedRungGlassMaterial = null;

function createStrandGlassMaterial(baseColorHex) {
  const c = new THREE.Color(baseColorHex);
  return new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: c },
      uTime: helixGlassUniforms.uTime,
      uFlowSpeed: helixGlassUniforms.uFlowSpeed,
      uFlowRepeat: helixGlassUniforms.uFlowRepeat,
      uFlowStrength: helixGlassUniforms.uFlowStrength,
      uOpacity: { value: 0.88 },
    },
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

function getRungGlassMaterial() {
  if (!sharedRungGlassMaterial) {
    sharedRungGlassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.85,
      metalness: 0.15,
      roughness: 0.35,
      transparent: true,
      opacity: 0.92,
      depthWrite: true,
      vertexColors: true,
    });
  }
  return sharedRungGlassMaterial;
}

/**
 * @returns {{ curve: THREE.CatmullRomCurve3, points: THREE.Vector3[] }}
 */
export function sampleHelixCurve(helixPointFn, phase, helixLength, segments = 400) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const x = (i / segments) * helixLength - helixLength / 2;
    points.push(helixPointFn(x, phase));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  curve.curveType = "centripetal";
  return { curve, points };
}

export function buildSolidStrand(curve, colorHex, opts = {}) {
  const tubularSegments = opts.tubularSegments ?? 160;
  const radius = opts.radius ?? 0.11;
  const radialSegments = opts.radialSegments ?? 12;
  const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  const mat = createStrandGlassMaterial(colorHex);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.isSolidStrand = true;
  return mesh;
}

function orientCylinderBetween(from, to, mesh) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  mesh.position.copy(mid);
  if (len > 1e-6) {
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  }
  mesh.scale.set(1, len, 1);
}

function setGeometryVertexColor(geo, colorHex) {
  const c = new THREE.Color(colorHex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

/** Solid rung: outer glass cylinder + brighter inner core. */
export function buildSolidRung(from, to, colorHex, scale) {
  const group = new THREE.Group();
  const outerR = Math.max(0.045, 0.052 * scale);
  const innerR = outerR * 0.55;
  const hitLen = new THREE.Vector3().subVectors(to, from).length();

  const outerGeo = new THREE.CylinderGeometry(outerR, outerR, 1, 14, 1, false);
  setGeometryVertexColor(outerGeo, colorHex);
  const outer = new THREE.Mesh(outerGeo, getRungGlassMaterial());
  orientCylinderBetween(from, to, outer);
  group.add(outer);

  const innerGeo = new THREE.CylinderGeometry(innerR, innerR, 1, 10, 1, false);
  const innerMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  orientCylinderBetween(from, to, inner);
  group.add(inner);

  group.userData.solidRungLength = hitLen;
  return group;
}

export function updateHelixGlassMotion(time, opts = {}) {
  helixGlassUniforms.uTime.value = time;
  const reduced = opts.reducedMotion ?? false;
  const tier = opts.tier ?? "high";
  if (reduced || tier === "low") {
    helixGlassUniforms.uFlowSpeed.value = 0;
    helixGlassUniforms.uFlowStrength.value = 0;
  } else if (tier === "medium") {
    helixGlassUniforms.uFlowSpeed.value = 0.22;
    helixGlassUniforms.uFlowStrength.value = 0.35;
  } else {
    helixGlassUniforms.uFlowSpeed.value = opts.flowSpeed ?? 0.35;
    helixGlassUniforms.uFlowStrength.value = opts.flowStrength ?? 0.55;
  }
}

export function disposeHelixGeometryResources() {
  sharedRungGlassMaterial = null;
}
