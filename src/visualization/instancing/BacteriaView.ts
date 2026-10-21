import * as THREE from 'three';
import { SimulationWorld } from '../../core/SimulationWorld';
import { BacteriaState, Bacterium, DeathCause } from '../../simulation/bacteria/Bacterium';
import { segmentSegment } from '../../simulation/CellGeometry';
import { CellLook, CellUniforms, createCapsuleGeometry, createCellDepthMaterial, createCellMaterial } from '../materials/CellMaterial';

const Y = new THREE.Vector3(0, 1, 0);

export function cellLook(w: SimulationWorld, b: Bacterium): CellLook {
  if (b.state === BacteriaState.Dead) return CellLook.Dead;
  if (!w.isHostSpecies(b.species)) return CellLook.NonHost;
  switch (b.state) {
    case BacteriaState.Infected: return CellLook.Infected;
    case BacteriaState.Resistant: return CellLook.Resistant;
    case BacteriaState.Inactive: return CellLook.Dormant;
    default: return CellLook.Susceptible;
  }
}

/** All bacteria as one instanced draw (rods and cocci share the stretched capsule). */
export class BacteriaView {
  readonly mesh: THREE.InstancedMesh;
  private readonly shape: THREE.InstancedBufferAttribute;
  private readonly info: THREE.InstancedBufferAttribute;
  private readonly capacity: number;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly pair = [0, 0];
  highlightId = -1;
  hiddenId = -1;

  constructor(uniforms: CellUniforms, capacity: number, detail: 'high' | 'low', shadows: boolean) {
    this.capacity = capacity;
    const geo = detail === 'high' ? createCapsuleGeometry(8, 22) : createCapsuleGeometry(5, 12);
    this.shape = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.info = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.shape.setUsage(THREE.DynamicDrawUsage);
    this.info.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aShape', this.shape);
    geo.setAttribute('aInfo', this.info);
    this.mesh = new THREE.InstancedMesh(geo, createCellMaterial(uniforms), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.customDepthMaterial = createCellDepthMaterial(uniforms);
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = shadows;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(w: SimulationWorld): void {
    const list = w.bacteria;
    const n = Math.min(list.length, this.capacity);
    const sh = this.shape.array as Float32Array;
    const inf = this.info.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      this.v.set(b.ax, b.ay, b.az);
      this.q.setFromUnitVectors(Y, this.v);
      this.s.setScalar(b.radius);
      this.v.set(b.x, b.y, b.z);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      const look = cellLook(w, b);
      const o = i * 4;
      sh[o] = b.halfLength / b.radius;
      sh[o + 1] = look;
      sh[o + 2] = b.state === BacteriaState.Infected ? Math.min(1, b.infTime / b.latent) : 0;
      sh[o + 3] = ((b.id * 0.6180339887) % 1 + 1) % 1;
      inf[o] = b.state === BacteriaState.Infected ? b.stage : 0;
      inf[o + 1] = b.activity;
      if (b.state === BacteriaState.Dead) {
        const linger = b.deathCause === DeathCause.Lysis ? 45 : 300;
        inf[o + 2] = Math.min(1, (w.time - b.deathTime) / linger);
      } else inf[o + 2] = 0;
      inf[o + 3] = b.id === this.hiddenId ? 2 : b.id === this.highlightId ? 1 : 0;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shape.needsUpdate = true;
    this.info.needsUpdate = true;
  }

  /** CPU ray–capsule picking (exact for the simulated shape). Returns the nearest hit cell. */
  pick(w: SimulationWorld, ray: THREE.Ray, maxDist = 400): { cell: Bacterium; distance: number } | null {
    let best: Bacterium | null = null;
    let bestT = Infinity;
    const half = maxDist / 2;
    const cx = ray.origin.x + ray.direction.x * half;
    const cy = ray.origin.y + ray.direction.y * half;
    const cz = ray.origin.z + ray.direction.z * half;
    for (const b of w.bacteria) {
      if (b.state === BacteriaState.Dead) continue;
      const d2 = segmentSegment(
        cx, cy, cz, ray.direction.x, ray.direction.y, ray.direction.z, half,
        b.x, b.y, b.z, b.ax, b.ay, b.az, b.halfLength, this.pair,
      );
      const r = b.radius * 1.05;
      if (d2 < r * r) {
        const t = this.pair[0] + half;
        if (t > 0 && t < bestT) {
          bestT = t;
          best = b;
        }
      }
    }
    return best ? { cell: best, distance: bestT } : null;
  }
}
