import * as THREE from 'three';
import { SimulationWorld } from '../../core/SimulationWorld';
import { BacteriaState, InfectionStage } from '../../simulation/bacteria/Bacterium';
import { attachPoint } from '../../simulation/CellGeometry';
import { buildInstancedPhageGeometry, PhageDims } from '../models/PhageGeometry';

export enum GlowKind {
  Free = 0,
  Lineage = 1,
  Tracked = 2,
  Attached = 3,
}

const GLOW_VERT = /* glsl */ `
attribute float aKind;
attribute float aSeed;
uniform float uPixelScale;
uniform float uTime;
uniform float uNearFade;
varying float vKind;
varying float vAlpha;
varying float vCore;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  // a labelled particle is ~0.2 µm, drawn no smaller than a few pixels (fluorescence look)
  float worldSize = aKind > 1.5 && aKind < 2.5 ? 0.9 : (aKind > 2.5 ? 0.35 : 0.5);
  float px = worldSize * uPixelScale / max(dist, 0.01);
  float minPx = aKind > 1.5 && aKind < 2.5 ? 9.0 : (aKind > 2.5 ? 2.0 : 3.0);
  gl_PointSize = clamp(px, minPx, 64.0);
  // fade out where the true-scale model takes over
  vAlpha = smoothstep(uNearFade * 0.45, uNearFade, dist);
  if (aKind > 1.5 && aKind < 2.5) vAlpha = max(vAlpha, 0.35);
  vAlpha *= 0.75 + 0.25 * sin(uTime * 2.0 + aSeed * 40.0);
  vCore = clamp(px / 6.0, 0.4, 1.0);
  vKind = aKind;
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAG = /* glsl */ `
varying float vKind;
varying float vAlpha;
varying float vCore;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float core = exp(-r * 9.0);
  float halo = exp(-r * 2.6) * 0.45;
  vec3 col = vec3(0.45, 1.0, 0.86);
  if (vKind > 0.5 && vKind < 1.5) col = vec3(1.0, 0.86, 0.45);
  if (vKind > 1.5 && vKind < 2.5) col = vec3(1.0, 0.95, 0.7);
  if (vKind > 2.5) col = vec3(0.7, 0.9, 1.0);
  float a = (core + halo) * vAlpha;
  gl_FragColor = vec4(col * (core * 1.8 + halo), a);
}
`;

/**
 * Individual phages: glowing points at every distance, true-scale instanced models near
 * the camera, and phages bound to cells (binding/injecting, then the empty ghost that remains).
 */
export class PhageView {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly pos: THREE.BufferAttribute;
  private readonly kind: THREE.BufferAttribute;
  private readonly seed: THREE.BufferAttribute;
  private readonly glowCap: number;
  readonly glowMaterial: THREE.ShaderMaterial;
  private readonly near: THREE.InstancedMesh;
  private readonly bound: THREE.InstancedMesh;
  private readonly ghosts: THREE.InstancedMesh;
  private readonly nearCap = 220;
  private readonly boundCap = 700;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly tmp = [0, 0, 0, 0, 0, 0];
  private nearIdx: number[] = [];
  private nearD: number[] = [];
  /** Interpolated positions of individuals from the last update (index-aligned with world.phages). */
  ix: Float32Array = new Float32Array(0);
  hideTrackedId = -1;
  nearFade = 4;

  constructor(dims: PhageDims, glowCap: number) {
    this.glowCap = glowCap;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(glowCap * 3), 3);
    this.kind = new THREE.BufferAttribute(new Float32Array(glowCap), 1);
    this.seed = new THREE.BufferAttribute(new Float32Array(glowCap), 1);
    for (const a of [this.pos, this.kind, this.seed]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('aKind', this.kind);
    g.setAttribute('aSeed', this.seed);
    this.glowMaterial = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { uPixelScale: { value: 800 }, uTime: { value: 0 }, uNearFade: { value: 4 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.glowMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.group.add(this.points);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.35,
      emissive: new THREE.Color('#1d4a52'),
      emissiveIntensity: 0.6,
      flatShading: true,
    });
    this.near = new THREE.InstancedMesh(buildInstancedPhageGeometry(dims, 0.35), mat, this.nearCap);
    this.bound = new THREE.InstancedMesh(buildInstancedPhageGeometry(dims, 1), mat, this.boundCap);
    const ghostMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: 0.55,
      flatShading: true,
      depthWrite: false,
    });
    this.ghosts = new THREE.InstancedMesh(buildInstancedPhageGeometry(dims, 1, true), ghostMat, this.boundCap);
    for (const im of [this.near, this.bound, this.ghosts]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      this.group.add(im);
    }
  }

  update(w: SimulationWorld, alpha: number, camera: THREE.PerspectiveCamera, pixelScale: number, time: number): void {
    const list = w.phages;
    const cam = camera.position;
    this.glowMaterial.uniforms.uPixelScale.value = pixelScale;
    this.glowMaterial.uniforms.uTime.value = time;
    this.glowMaterial.uniforms.uNearFade.value = this.nearFade;
    if (this.ix.length < list.length * 3) this.ix = new Float32Array(Math.max(1024, list.length * 6));
    const p = this.pos.array as Float32Array;
    const k = this.kind.array as Float32Array;
    const s = this.seed.array as Float32Array;
    let g = 0;
    const nearIdx = this.nearIdx;
    const nearD = this.nearD;
    nearIdx.length = 0;
    nearD.length = 0;
    const nearR2 = this.nearFade * this.nearFade * 1.2;
    for (let i = 0; i < list.length; i++) {
      const ph = list[i];
      const x = ph.px + (ph.x - ph.px) * alpha;
      const y = ph.py + (ph.y - ph.py) * alpha;
      const z = ph.pz + (ph.z - ph.pz) * alpha;
      this.ix[i * 3] = x;
      this.ix[i * 3 + 1] = y;
      this.ix[i * 3 + 2] = z;
      const tracked = ph.id === w.trackedPhageId;
      if (g < this.glowCap) {
        p[g * 3] = x;
        p[g * 3 + 1] = y;
        p[g * 3 + 2] = z;
        k[g] = tracked ? GlowKind.Tracked : ph.lineage ? GlowKind.Lineage : GlowKind.Free;
        s[g] = (ph.id * 0.137) % 1;
        g++;
      }
      if (tracked && ph.id === this.hideTrackedId) continue;
      const d2 = (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2;
      if (d2 < nearR2) {
        nearIdx.push(i);
        nearD.push(d2);
      }
    }

    // phages bound to cells
    let nb = 0;
    let ng = 0;
    const tmp = this.tmp;
    const boundR2 = 45 * 45;
    for (const c of w.bacteria) {
      if (c.state !== BacteriaState.Infected) continue;
      attachPoint(c, c.attachU, c.attachTheta, tmp);
      const ghost = c.stage > InfectionStage.Injecting;
      if (g < this.glowCap && !ghost) {
        p[g * 3] = tmp[0] + tmp[3] * 0.1;
        p[g * 3 + 1] = tmp[1] + tmp[4] * 0.1;
        p[g * 3 + 2] = tmp[2] + tmp[5] * 0.1;
        k[g] = c.founderId === w.trackedPhageId ? GlowKind.Tracked : GlowKind.Attached;
        s[g] = (c.id * 0.31) % 1;
        g++;
      }
      if (c.founderId === this.hideTrackedId && c.founderId >= 0) continue;
      const d2 = (tmp[0] - cam.x) ** 2 + (tmp[1] - cam.y) ** 2 + (tmp[2] - cam.z) ** 2;
      if (d2 > boundR2) continue;
      this.n.set(tmp[3], tmp[4], tmp[5]);
      this.q.setFromUnitVectors(Y_AXIS, this.n);
      // spin around the normal so neighbouring phages do not look cloned
      this.e.set(0, (c.id % 13) * 0.5, 0);
      this.q.multiply(this.q2.setFromEuler(this.e));
      this.v.set(tmp[0] - tmp[3] * 0.004, tmp[1] - tmp[4] * 0.004, tmp[2] - tmp[5] * 0.004);
      this.m.compose(this.v, this.q, this.one);
      if (ghost) {
        if (ng < this.boundCap) this.ghosts.setMatrixAt(ng++, this.m);
      } else if (nb < this.boundCap) this.bound.setMatrixAt(nb++, this.m);
    }
    this.bound.count = nb;
    this.ghosts.count = ng;
    this.bound.instanceMatrix.needsUpdate = true;
    this.ghosts.instanceMatrix.needsUpdate = true;

    // nearest free particles as true-scale models, tumbling slowly (presentational)
    let order: number[] = nearIdx.map((_, j) => j);
    if (order.length > this.nearCap) order = order.sort((a, b) => nearD[a] - nearD[b]).slice(0, this.nearCap);
    let nn = 0;
    for (const j of order) {
      const i = nearIdx[j];
      const ph = list[i];
      const sd = ph.id * 1.731;
      this.e.set(Math.sin(time * 0.7 + sd) * 2.0 + sd, time * 0.5 + sd * 2.3, Math.cos(time * 0.6 + sd) * 1.6);
      this.q.setFromEuler(this.e);
      this.v.set(this.ix[i * 3], this.ix[i * 3 + 1], this.ix[i * 3 + 2]);
      // models are anchored at the baseplate; centre them on the particle
      this.n.set(0, -0.1, 0).applyQuaternion(this.q);
      this.v.add(this.n);
      this.m.compose(this.v, this.q, this.one);
      this.near.setMatrixAt(nn++, this.m);
    }
    this.near.count = nn;
    this.near.instanceMatrix.needsUpdate = true;

    (this.points.geometry as THREE.BufferGeometry).setDrawRange(0, g);
    this.pos.needsUpdate = true;
    this.kind.needsUpdate = true;
    this.seed.needsUpdate = true;
  }

  /** Screen-space pick of the nearest individual phage within `radiusPx`. */
  pick(w: SimulationWorld, camera: THREE.Camera, ndcX: number, ndcY: number, width: number, height: number, radiusPx = 16): { id: number; depth: number } | null {
    let best = -1;
    let bestD = radiusPx * radiusPx;
    let depth = 0;
    const v = this.v;
    for (let i = 0; i < w.phages.length; i++) {
      v.set(this.ix[i * 3], this.ix[i * 3 + 1], this.ix[i * 3 + 2]);
      const dist = v.distanceTo(camera.position);
      v.project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const dx = ((v.x - ndcX) * width) / 2;
      const dy = ((v.y - ndcY) * height) / 2;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
        depth = dist;
      }
    }
    return best >= 0 ? { id: w.phages[best].id, depth } : null;
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
