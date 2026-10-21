import * as THREE from 'three';
import { SimulationWorld } from '../core/SimulationWorld';
import { BacteriaState, Bacterium, InfectionStage } from '../simulation/bacteria/Bacterium';
import { InfectionSystem } from '../simulation/infection/InfectionSystem';
import { CELL_COLORS } from './materials/CellMaterial';
import { buildInstancedPhageGeometry, capsidGeometry, PhageDims } from './models/PhageGeometry';
import { cellLook } from './instancing/BacteriaView';

const Y = new THREE.Vector3(0, 1, 0);
const MAX_VIRIONS = 260;
const RIBOSOMES = 520;

/**
 * "Cell interior" scale (design §1 multi-scale): when the camera is close to the focused
 * cell, its instanced version is hidden and replaced by a translucent cell with
 * ribosomes, the host nucleoid, replicating phage genomes and assembling virions.
 * Counts and stages are read from the simulation; positions inside are presentational.
 */
export class HeroCell {
  readonly group = new THREE.Group();
  private readonly outer: THREE.Mesh;
  private readonly inner: THREE.Mesh;
  private readonly outerMat: THREE.ShaderMaterial;
  private readonly innerMat: THREE.ShaderMaterial;
  private readonly ribosomes: THREE.InstancedMesh;
  private readonly nucleoid: THREE.Mesh;
  private readonly nucleoidMat: THREE.MeshStandardMaterial;
  private readonly phageDna: THREE.Mesh[] = [];
  private readonly phageDnaMat: THREE.MeshBasicMaterial;
  private readonly virions: THREE.InstancedMesh;
  private readonly procapsids: THREE.InstancedMesh;
  private readonly pili: THREE.LineSegments;
  private readonly flagella: THREE.Group;
  private readonly ribosomeSeeds: Float32Array;
  private readonly virionSeeds: Float32Array;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private currentId = -1;
  private builtHalf = -1;
  private builtRadius = -1;
  private readonly color = new THREE.Color();
  cellId = -1;
  amount = 0;

  constructor(dims: PhageDims, clipping: THREE.Plane[]) {
    this.outerMat = membraneMaterial(clipping, 0.07, 0.75);
    this.innerMat = membraneMaterial(clipping, 0.03, 0.35);
    this.outer = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 10, 32), this.outerMat);
    this.inner = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 8, 24), this.innerMat);
    this.outer.renderOrder = 8;
    this.inner.renderOrder = 7;
    this.group.add(this.inner, this.outer);

    const ribMat = new THREE.MeshStandardMaterial({ color: '#c9d8e6', roughness: 0.6, emissive: '#2a4a66', emissiveIntensity: 0.4, clippingPlanes: clipping });
    this.ribosomes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.013, 0), ribMat, RIBOSOMES);
    this.ribosomeSeeds = seeds(RIBOSOMES * 3, 99);
    this.group.add(this.ribosomes);

    this.nucleoidMat = new THREE.MeshStandardMaterial({
      color: '#7fb6ff',
      emissive: '#3a7dff',
      emissiveIntensity: 0.9,
      roughness: 0.5,
      transparent: true,
      opacity: 0.85,
      clippingPlanes: clipping,
    });
    this.nucleoid = new THREE.Mesh(new THREE.BufferGeometry(), this.nucleoidMat);
    this.group.add(this.nucleoid);

    this.phageDnaMat = new THREE.MeshBasicMaterial({
      color: '#63ffd6',
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      clippingPlanes: clipping,
    });
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.phageDnaMat);
      this.phageDna.push(mesh);
      this.group.add(mesh);
    }

    const virionMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.3,
      metalness: 0.35,
      emissive: '#2c6a72',
      emissiveIntensity: 0.8,
      flatShading: true,
      clippingPlanes: clipping,
    });
    this.virions = new THREE.InstancedMesh(buildInstancedPhageGeometry(dims, 0, false, true), virionMat, MAX_VIRIONS);
    const procMat = new THREE.MeshStandardMaterial({
      color: '#bfe9ff',
      transparent: true,
      opacity: 0.45,
      roughness: 0.4,
      flatShading: true,
      emissive: '#3b8fb0',
      emissiveIntensity: 0.6,
      depthWrite: false,
      clippingPlanes: clipping,
    });
    this.procapsids = new THREE.InstancedMesh(capsidGeometry(dims.headRadius * 0.92, dims.headElongation * 0.95), procMat, 60);
    this.virionSeeds = seeds(MAX_VIRIONS * 6, 7);
    this.group.add(this.virions, this.procapsids);

    const piliMat = new THREE.LineBasicMaterial({ color: '#9cc9ff', transparent: true, opacity: 0.35, depthWrite: false, clippingPlanes: clipping });
    this.pili = new THREE.LineSegments(new THREE.BufferGeometry(), piliMat);
    this.group.add(this.pili);
    this.flagella = new THREE.Group();
    this.group.add(this.flagella);

    this.group.visible = false;
  }

  /** Rebuild geometry that depends on the cell's size (rarely: cells grow slowly). */
  private rebuild(c: Bacterium): void {
    this.builtHalf = c.halfLength;
    this.builtRadius = c.radius;
    const r = c.radius;
    const h = c.halfLength;
    this.outer.geometry.dispose();
    this.outer.geometry = new THREE.CapsuleGeometry(r, 2 * h, 10, 32);
    this.inner.geometry.dispose();
    this.inner.geometry = new THREE.CapsuleGeometry(r * 0.92, 2 * h, 8, 24);

    // host chromosome: a long confined random walk, looped through the centre
    const rnd = mulberry(c.id * 7919 + 13);
    const pts: THREE.Vector3[] = [];
    const p = new THREE.Vector3();
    const span = Math.max(0.12, h * 0.85);
    for (let i = 0; i < 90; i++) {
      p.x += (rnd() - 0.5) * 0.16;
      p.y += (rnd() - 0.5) * 0.22;
      p.z += (rnd() - 0.5) * 0.16;
      const rr = Math.hypot(p.x, p.z);
      if (rr > r * 0.45) {
        p.x *= (r * 0.45) / rr;
        p.z *= (r * 0.45) / rr;
      }
      p.y = Math.max(-span, Math.min(span, p.y));
      pts.push(p.clone());
    }
    this.nucleoid.geometry.dispose();
    this.nucleoid.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 600, 0.014, 5);

    for (let k = 0; k < this.phageDna.length; k++) {
      const rp = mulberry(c.id * 31 + k * 101);
      const dp: THREE.Vector3[] = [];
      const q = new THREE.Vector3((rp() - 0.5) * r * 0.6, (rp() - 0.5) * span * 1.6, (rp() - 0.5) * r * 0.6);
      for (let i = 0; i < 40; i++) {
        q.x += (rp() - 0.5) * 0.14;
        q.y += (rp() - 0.5) * 0.18;
        q.z += (rp() - 0.5) * 0.14;
        const rr = Math.hypot(q.x, q.z);
        if (rr > r * 0.7) {
          q.x *= (r * 0.7) / rr;
          q.z *= (r * 0.7) / rr;
        }
        q.y = Math.max(-span - r * 0.4, Math.min(span + r * 0.4, q.y));
        dp.push(q.clone());
      }
      this.phageDna[k].geometry.dispose();
      this.phageDna[k].geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dp), 260, 0.008, 4);
    }

    // pili radiating from the envelope
    const piliPos: number[] = [];
    const rpl = mulberry(c.id * 3 + 5);
    for (let i = 0; i < 90; i++) {
      const y = (rpl() * 2 - 1) * (h + r * 0.6);
      const a = rpl() * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const len = 0.12 + rpl() * 0.25;
      piliPos.push(nx * r, y, nz * r, nx * (r + len), y + (rpl() - 0.5) * 0.1, nz * (r + len));
    }
    this.pili.geometry.dispose();
    this.pili.geometry = new THREE.BufferGeometry();
    this.pili.geometry.setAttribute('position', new THREE.Float32BufferAttribute(piliPos, 3));

    // a few helical flagella from the poles (rods only)
    for (const f of this.flagella.children) (f as THREE.Mesh).geometry.dispose();
    this.flagella.clear();
    if (h > 0.2) {
      const fm = new THREE.MeshStandardMaterial({ color: '#8fb8de', roughness: 0.5, emissive: '#1d3a5a', clippingPlanes: this.outerMat.clippingPlanes ?? undefined });
      for (let i = 0; i < 3; i++) {
        const helix: THREE.Vector3[] = [];
        const a0 = rpl() * Math.PI * 2;
        for (let k = 0; k < 80; k++) {
          const t = k / 79;
          helix.push(new THREE.Vector3(Math.cos(t * 30 + a0) * 0.1 * t + Math.cos(a0) * 0.2, -(h + r) - t * 4.5, Math.sin(t * 30 + a0) * 0.1 * t + Math.sin(a0) * 0.2));
        }
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 240, 0.01, 4), fm);
        this.flagella.add(mesh);
      }
    }
  }

  update(w: SimulationWorld, c: Bacterium | null, amount: number, time: number): void {
    this.amount = amount;
    if (!c || amount <= 0.01) {
      this.group.visible = false;
      this.cellId = -1;
      return;
    }
    this.group.visible = true;
    this.cellId = c.id;
    if (c.id !== this.currentId || Math.abs(c.halfLength - this.builtHalf) > 0.03 || c.radius !== this.builtRadius) {
      this.currentId = c.id;
      this.rebuild(c);
    }
    this.v.set(c.ax, c.ay, c.az);
    this.q.setFromUnitVectors(Y, this.v);
    this.group.position.set(c.x, c.y, c.z);
    this.group.quaternion.copy(this.q);

    const look = cellLook(w, c);
    this.color.set(CELL_COLORS[look]);
    this.outerMat.uniforms.uColor.value.copy(this.color);
    this.outerMat.uniforms.uAmount.value = amount;
    this.innerMat.uniforms.uColor.value.copy(this.color).lerp(new THREE.Color('#9fd8ff'), 0.4);
    this.innerMat.uniforms.uAmount.value = amount;
    this.outerMat.uniforms.uTime.value = time;

    const infected = c.state === BacteriaState.Infected;
    const stage = infected ? c.stage : InfectionStage.None;
    const pp = w.phageParams;
    const r = c.radius;
    const h = c.halfLength;

    // ribosomes jitter in place; they thin out as the host is taken over
    const ribKeep = !infected ? 1 : stage <= InfectionStage.Injecting ? 1 : stage === InfectionStage.Early ? 0.85 : 0.6;
    let nr = 0;
    for (let i = 0; i < RIBOSOMES; i++) {
      if (i / RIBOSOMES > ribKeep) break;
      const a = this.ribosomeSeeds[i * 3] * Math.PI * 2;
      const rr = Math.sqrt(this.ribosomeSeeds[i * 3 + 1]) * r * 0.82;
      const y = (this.ribosomeSeeds[i * 3 + 2] * 2 - 1) * (h + r * 0.55);
      const yy = Math.abs(y) > h ? Math.sign(y) * (h + Math.sqrt(Math.max(0, (r * 0.8) ** 2 - rr * rr)) * ((Math.abs(y) - h) / (r * 0.55))) : y;
      const j = 0.008 * Math.sin(time * 3 + i);
      this.v.set(Math.cos(a) * rr + j, yy + j, Math.sin(a) * rr - j);
      this.m.makeTranslation(this.v.x, this.v.y, this.v.z);
      this.ribosomes.setMatrixAt(nr++, this.m);
    }
    this.ribosomes.count = nr;
    this.ribosomes.instanceMatrix.needsUpdate = true;

    // host nucleoid fades during takeover
    let hostDna = 1;
    if (infected) {
      if (stage === InfectionStage.Early) {
        const t0 = pp.adsorbPhase + pp.injectPhase;
        const t1 = Math.max(t0 + 30, pp.eclipse * 0.35);
        hostDna = 1 - (c.infTime - t0) / (t1 - t0);
      } else if (stage > InfectionStage.Early) hostDna = 0;
    }
    hostDna = Math.max(0, Math.min(1, hostDna));
    this.nucleoidMat.opacity = 0.85 * hostDna * amount;
    this.nucleoid.visible = hostDna > 0.01;
    const nIdx = this.nucleoid.geometry.index;
    if (nIdx) this.nucleoid.geometry.setDrawRange(0, Math.floor((nIdx.count * (0.25 + 0.75 * hostDna)) / 3) * 3);
    const nucColor = look === 5 ? '#ff8ab8' : '#7fb6ff';
    this.nucleoidMat.color.set(nucColor);
    this.nucleoidMat.emissive.set(nucColor).multiplyScalar(0.5);

    // replicating phage genomes
    let rep = 0;
    if (infected) {
      if (stage === InfectionStage.Early) rep = 0.15;
      else if (stage === InfectionStage.Replication) {
        const t0 = Math.max(pp.adsorbPhase + pp.injectPhase + 30, pp.eclipse * 0.35);
        rep = 0.15 + 0.85 * (c.infTime - t0) / (pp.eclipse - t0);
      } else if (stage === InfectionStage.Assembly) rep = 1;
    }
    for (let k = 0; k < this.phageDna.length; k++) {
      const mesh = this.phageDna[k];
      const share = Math.max(0, Math.min(1, rep * this.phageDna.length - k));
      mesh.visible = share > 0.01;
      const idx = mesh.geometry.index;
      if (idx) mesh.geometry.setDrawRange(0, Math.floor((idx.count * share) / 3) * 3);
    }
    this.phageDnaMat.opacity = (0.55 + 0.35 * Math.sin(time * 2.5)) * amount;

    // assembled virions + procapsids awaiting packaging
    const mature = infected ? Math.min(MAX_VIRIONS, InfectionSystem.matureCount(c, pp.eclipse)) : 0;
    const pro = infected && stage === InfectionStage.Assembly ? Math.min(60, Math.ceil(c.burst * 0.18)) : 0;
    let nv = 0;
    for (let i = 0; i < mature; i++) {
      this.placeInside(i, r, h, time, 1);
      this.virions.setMatrixAt(nv++, this.m);
    }
    this.virions.count = nv;
    this.virions.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < pro; i++) {
      this.placeInside(MAX_VIRIONS - 1 - i, r, h, time, 0.9);
      this.procapsids.setMatrixAt(i, this.m);
    }
    this.procapsids.count = pro;
    this.procapsids.instanceMatrix.needsUpdate = true;

    this.pili.visible = look !== 3;
    (this.pili.material as THREE.LineBasicMaterial).opacity = 0.35 * amount;
    this.flagella.visible = look !== 3 && look !== 5;
    this.flagella.rotation.y = time * 2.5;
  }

  private placeInside(i: number, r: number, h: number, time: number, scale: number): void {
    const sd = this.virionSeeds;
    const a = sd[i * 6] * Math.PI * 2;
    const rr = Math.sqrt(sd[i * 6 + 1]) * r * 0.62;
    const y = (sd[i * 6 + 2] * 2 - 1) * (h + r * 0.3);
    const wob = 0.01 * Math.sin(time * 1.5 + i);
    this.v.set(Math.cos(a) * rr, y + wob, Math.sin(a) * rr);
    this.e.set(sd[i * 6 + 3] * 6.28 + time * 0.1, sd[i * 6 + 4] * 6.28, sd[i * 6 + 5] * 6.28);
    this.q.setFromEuler(this.e);
    this.s.setScalar(scale);
    this.m.compose(this.v, this.q, this.s);
  }
}

/** Translucent envelope: fresnel-weighted, so the interior stays readable (design §5.3). */
function membraneMaterial(clipping: THREE.Plane[], base: number, rimStrength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    clippingPlanes: clipping,
    uniforms: {
      uColor: { value: new THREE.Color('#3987e5') },
      uAmount: { value: 1 },
      uTime: { value: 0 },
      uBase: { value: base },
      uRim: { value: rimStrength },
    },
    vertexShader: /* glsl */ `
      #include <clipping_planes_pars_vertex>
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        vec3 transformed = position;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mvPosition.xyz;
        vP = position;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor;
      uniform float uAmount;
      uniform float uTime;
      uniform float uBase;
      uniform float uRim;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        #include <clipping_planes_fragment>
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(1.0 - facing, 2.2);
        // fine lipid texture
        float tex = 0.85 + 0.15 * sin(vP.y * 60.0 + sin(vP.x * 40.0 + uTime * 0.6) * 2.0);
        float a = (uBase + rim * uRim) * uAmount * tex;
        vec3 col = mix(uColor, vec3(0.9, 0.97, 1.0), rim * 0.35) * (0.6 + rim * 1.4);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
}

function seeds(n: number, s: number): Float32Array {
  const r = mulberry(s);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = r();
  return a;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
