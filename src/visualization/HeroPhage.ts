import * as THREE from 'three';
import { SimulationWorld } from '../core/SimulationWorld';
import { Bacterium, InfectionStage } from '../simulation/bacteria/Bacterium';
import { attachPoint } from '../simulation/CellGeometry';
import { capsidGeometry, fiberPoints, PhageDims } from './models/PhageGeometry';

const Y = new THREE.Vector3(0, 1, 0);

/**
 * The tracked phage as a fully articulated model: waving tail fibres, sheath
 * contraction and genome injection. Used near the camera only.
 */
export class HeroPhage {
  readonly group = new THREE.Group();
  private readonly dims: PhageDims;
  private readonly sheath = new THREE.Group();
  private readonly headMesh: THREE.Mesh;
  private readonly dnaCore: THREE.Mesh;
  private readonly fiberMeshes: THREE.Mesh[] = [];
  private readonly kneeMeshes: THREE.Mesh[] = [];
  private readonly dnaStrand: THREE.Mesh;
  private readonly dnaMat: THREE.MeshBasicMaterial;
  private readonly halo: THREE.Mesh;
  private readonly pts: THREE.Vector3[] = [];
  private readonly tmp = [0, 0, 0, 0, 0, 0];
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly up = new THREE.Vector3();
  private spread = 0.3;
  private contraction = 0;
  visibleAmount = 0;

  constructor(dims: PhageDims, clipping: THREE.Plane[]) {
    this.dims = dims;
    const d = dims;
    const protein = new THREE.MeshStandardMaterial({ color: '#a9c8d6', roughness: 0.3, metalness: 0.4, flatShading: true, clippingPlanes: clipping });
    const headMat = new THREE.MeshPhysicalMaterial({
      color: '#d6ecf7',
      roughness: 0.22,
      metalness: 0.15,
      clearcoat: 0.6,
      flatShading: true,
      transparent: true,
      opacity: 0.82,
      clippingPlanes: clipping,
    });
    this.headMesh = new THREE.Mesh(capsidGeometry(d.headRadius, d.headElongation, 0), headMat);
    this.headMesh.position.y = d.headCenter;
    this.group.add(this.headMesh);
    // packed genome glowing inside the capsid
    this.dnaCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(d.headRadius * 0.72, 2),
      new THREE.MeshBasicMaterial({ color: '#6ff5d8', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.dnaCore.scale.y = d.headElongation;
    this.dnaCore.position.y = d.headCenter;
    this.group.add(this.dnaCore);

    const headBottom = d.headCenter - d.headRadius * d.headElongation * 0.82;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(d.baseplateRadius, d.baseplateRadius * 0.8, 0.008, 6), protein);
    base.position.y = 0.004;
    this.group.add(base);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(d.tailRadius * 0.45, d.tailRadius * 0.45, headBottom - 0.008, 8), protein);
    tube.position.y = 0.008 + (headBottom - 0.008) / 2;
    this.group.add(tube);
    if (d.tailLength > 0.05) {
      const rings = 12;
      const len = headBottom - 0.016;
      for (let k = 0; k < rings; k++) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(d.tailRadius, d.tailRadius * 0.9, (len / rings) * 0.8, 10), protein);
        ring.position.y = (len / rings) * (k + 0.5);
        this.sheath.add(ring);
      }
      this.sheath.position.y = 0.012;
      this.group.add(this.sheath);
    }
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(d.fiberRadius, d.fiberRadius, 1, 5), protein);
      this.fiberMeshes.push(m);
      this.group.add(m);
    }
    for (let i = 0; i < 6; i++) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(d.fiberRadius * 1.5, 6, 4), protein);
      this.kneeMeshes.push(k);
      this.group.add(k);
    }

    // genome travelling down the tail during injection
    this.dnaMat = new THREE.MeshBasicMaterial({ color: '#7dffe0', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: clipping });
    const curve = new THREE.CatmullRomCurve3(
      Array.from({ length: 14 }, (_, i) => {
        const t = i / 13;
        return new THREE.Vector3(Math.sin(t * 9) * 0.05 * t, d.headCenter - t * (d.headCenter + 0.45), Math.cos(t * 7) * 0.05 * t);
      }),
    );
    this.dnaStrand = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.0035, 5), this.dnaMat);
    this.dnaStrand.visible = false;
    this.group.add(this.dnaStrand);

    // soft highlight so the tracked particle is findable against busy backgrounds
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 20, 14),
      new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.halo.position.y = 0.1;
    this.group.add(this.halo);
    this.group.visible = false;
  }

  /** Pose for a free particle at p (interpolated), tumbling like the instanced ones. */
  poseFree(x: number, y: number, z: number, id: number, time: number, dt: number): void {
    const sd = id * 1.731;
    this.e.set(Math.sin(time * 0.7 + sd) * 2.0 + sd, time * 0.5 + sd * 2.3, Math.cos(time * 0.6 + sd) * 1.6);
    this.q.setFromEuler(this.e);
    this.group.quaternion.copy(this.q);
    this.up.set(0, -0.1, 0).applyQuaternion(this.q);
    this.group.position.set(x + this.up.x, y + this.up.y, z + this.up.z);
    this.animate(0.28 + 0.12 * Math.sin(time * 1.3), 0, -1, time, dt);
  }

  /** Pose bound to a cell surface. */
  poseBound(w: SimulationWorld, c: Bacterium, time: number, dt: number): void {
    attachPoint(c, c.attachU, c.attachTheta, this.tmp);
    this.up.set(this.tmp[3], this.tmp[4], this.tmp[5]);
    this.q.setFromUnitVectors(Y, this.up);
    this.group.quaternion.copy(this.q);
    const pp = w.phageParams;
    let spread = 1;
    let contraction = 0;
    let inject = -1;
    if (c.stage === InfectionStage.Adsorbing) {
      spread = 0.35 + 0.65 * smooth(c.infTime / pp.adsorbPhase);
    } else {
      const ti = (c.infTime - pp.adsorbPhase) / pp.injectPhase;
      contraction = smooth(Math.min(1, ti * 3));
      inject = Math.min(1, Math.max(0, ti));
      if (c.stage > InfectionStage.Injecting) inject = 1;
    }
    // the contracted sheath drives the tube through the envelope: the particle sinks slightly
    const sink = contraction * (this.dims.tailLength > 0.05 ? 0.045 : 0.01);
    this.group.position.set(this.tmp[0] - this.up.x * sink, this.tmp[1] - this.up.y * sink, this.tmp[2] - this.up.z * sink);
    this.animate(spread, contraction, inject, time, dt);
  }

  private animate(spreadTarget: number, contraction: number, inject: number, time: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 5);
    this.spread += (spreadTarget - this.spread) * k;
    this.contraction += (contraction - this.contraction) * k;
    const d = this.dims;
    for (let i = 0; i < 6; i++) {
      const wave = Math.sin(time * 2.2 + i * 1.7) * 0.08 * (1 - this.spread);
      fiberPoints(d, i, Math.min(1, Math.max(0, this.spread + wave)), this.pts);
      placeCylinder(this.fiberMeshes[i * 2], this.pts[0], this.pts[1]);
      placeCylinder(this.fiberMeshes[i * 2 + 1], this.pts[1], this.pts[2]);
      this.kneeMeshes[i].position.copy(this.pts[1]);
    }
    if (this.sheath.children.length > 0) {
      const c = this.contraction;
      this.sheath.scale.set(1 + c * 0.55, 1 - c * 0.55, 1 + c * 0.55);
      // a contracted sheath shortens toward the head, exposing the tube at the bottom
      const headBottom = d.headCenter - d.headRadius * d.headElongation * 0.82;
      this.sheath.position.y = 0.012 + (headBottom - 0.016) * 0.55 * c;
    }
    const dnaLeft = inject < 0 ? 1 : 1 - inject;
    const core = this.dnaCore.material as THREE.MeshBasicMaterial;
    core.opacity = 0.15 + 0.75 * dnaLeft;
    this.dnaCore.scale.setScalar(0.4 + 0.6 * dnaLeft);
    this.dnaCore.scale.y *= d.headElongation;
    const strand = inject > 0 && inject < 1;
    this.dnaStrand.visible = strand;
    if (strand) {
      const idx = this.dnaStrand.geometry.index!;
      this.dnaStrand.geometry.setDrawRange(0, Math.floor(idx.count * Math.min(1, inject * 1.15) / 6) * 6);
      this.dnaMat.opacity = 0.6 + 0.4 * Math.sin(time * 10);
    }
  }
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

const dir = new THREE.Vector3();
function placeCylinder(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  dir.subVectors(b, a);
  const len = dir.length();
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.scale.set(1, len, 1);
  m.quaternion.setFromUnitVectors(Y, dir.normalize());
}
