import * as THREE from 'three';
import { SimulationWorld } from '../../core/SimulationWorld';

const VERT = /* glsl */ `
attribute float aSeed;
attribute float aWeight;
uniform float uPixelScale;
uniform float uTime;
uniform float uSize;
varying float vA;
void main() {
  // slow drift inside the voxel (presentational: population-mode particles have no individual positions)
  vec3 p = position;
  float s = aSeed * 6.2831;
  p += vec3(sin(uTime * 0.21 + s), sin(uTime * 0.17 + s * 1.7), cos(uTime * 0.19 + s * 2.3)) * 0.9;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  gl_PointSize = clamp(uSize * uPixelScale / max(dist, 0.1), 1.5, 90.0);
  vA = aWeight * smoothstep(1.0, 6.0, dist);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = exp(-r * 4.0) * vA;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/**
 * Population-mode phages drawn as a density cloud: a few drifting dots per voxel plus a
 * soft fluorescent haze whose intensity follows the voxel count.
 */
export class PopulationCloudView {
  readonly group = new THREE.Group();
  private readonly dots: THREE.Points;
  private readonly haze: THREE.Points;
  private readonly dotMat: THREE.ShaderMaterial;
  private readonly hazeMat: THREE.ShaderMaterial;
  private readonly cap: number;
  private lastRebuild = -1;

  constructor(cap: number) {
    this.cap = cap;
    const mk = (size: number, color: string, n: number) =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uPixelScale: { value: 800 }, uTime: { value: 0 }, uSize: { value: size }, uColor: { value: new THREE.Color(color) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        defines: { N: n },
      });
    this.dotMat = mk(0.45, '#7dfde0', 0);
    this.hazeMat = mk(14, '#2bd3b5', 1);
    this.dots = new THREE.Points(this.makeGeometry(cap), this.dotMat);
    this.haze = new THREE.Points(this.makeGeometry(400), this.hazeMat);
    for (const p of [this.dots, this.haze]) {
      p.frustumCulled = false;
      p.renderOrder = 4;
      this.group.add(p);
    }
  }

  private makeGeometry(n: number): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aWeight', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setDrawRange(0, 0);
    return g;
  }

  update(w: SimulationWorld, pixelScale: number, time: number): void {
    for (const m of [this.dotMat, this.hazeMat]) {
      m.uniforms.uPixelScale.value = pixelScale;
      m.uniforms.uTime.value = time;
    }
    if (time - this.lastRebuild < 0.25) return;
    this.lastRebuild = time;
    const counts = w.population.counts;
    const env = w.env;
    const vs = env.params.voxelSize;
    const o = [0, 0, 0];
    const dg = this.dots.geometry;
    const hg = this.haze.geometry;
    const dp = dg.getAttribute('position').array as Float32Array;
    const ds = dg.getAttribute('aSeed').array as Float32Array;
    const dw = dg.getAttribute('aWeight').array as Float32Array;
    const hp = hg.getAttribute('position').array as Float32Array;
    const hs = hg.getAttribute('aSeed').array as Float32Array;
    const hw = hg.getAttribute('aWeight').array as Float32Array;
    let nd = 0;
    let nh = 0;
    for (let v = 0; v < counts.length; v++) {
      const c = counts[v];
      if (c === 0) continue;
      env.voxelOrigin(v, o);
      const show = Math.min(90, Math.ceil(Math.pow(c, 0.62)));
      for (let i = 0; i < show && nd < this.cap; i++) {
        const h = hash3(v * 977 + i * 131);
        dp[nd * 3] = o[0] + h[0] * vs;
        dp[nd * 3 + 1] = o[1] + 0.3 + h[1] * (vs - 0.3);
        dp[nd * 3 + 2] = o[2] + h[2] * vs;
        ds[nd] = hash3(v * 31 + i * 7)[0];
        dw[nd] = 0.9;
        nd++;
      }
      // haze: a few large soft sprites per occupied voxel
      const intensity = Math.min(1, Math.log10(1 + c) / 3.2);
      for (let i = 0; i < 2 && nh < 400; i++) {
        const h = hash3(v * 53 + i * 19);
        hp[nh * 3] = o[0] + (0.25 + h[0] * 0.5) * vs;
        hp[nh * 3 + 1] = o[1] + (0.2 + h[1] * 0.5) * vs;
        hp[nh * 3 + 2] = o[2] + (0.25 + h[2] * 0.5) * vs;
        hs[nh] = h[0];
        hw[nh] = intensity * 0.09;
        nh++;
      }
    }
    dg.setDrawRange(0, nd);
    hg.setDrawRange(0, nh);
    for (const g of [dg, hg]) {
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('aSeed').needsUpdate = true;
      g.getAttribute('aWeight').needsUpdate = true;
    }
  }
}

const out = [0, 0, 0];
function hash3(n: number): number[] {
  let x = (n * 2654435761) >>> 0;
  for (let k = 0; k < 3; k++) {
    x ^= x >>> 15;
    x = Math.imul(x, 0x2c1b3c6d) >>> 0;
    x ^= x >>> 12;
    x = Math.imul(x, 0x297a2d39) >>> 0;
    x ^= x >>> 15;
    out[k] = x / 4294967296;
  }
  return out;
}
