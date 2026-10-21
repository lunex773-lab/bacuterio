import { SimEventType } from '../../core/EventQueue';
import type { SimulationWorld } from '../../core/SimulationWorld';
import { capsuleVolume, segmentSegment } from '../CellGeometry';
import { SpatialHash } from '../spatial/SpatialHash';
import { BacteriaState, Bacterium, DeathCause, InfectionStage } from './Bacterium';

const GHOST_LYSIS = 45;
const GHOST_NATURAL = 300;

/** Growth, division, dormancy, death and contact mechanics of the bacterial population. */
export class BacteriaSystem {
  readonly world: SimulationWorld;
  readonly hash: SpatialHash;
  xs: Float64Array = new Float64Array(0);
  ys: Float64Array = new Float64Array(0);
  zs: Float64Array = new Float64Array(0);
  private push: Float64Array = new Float64Array(0);
  private readonly pair = [0, 0];
  private readonly near = new Int32Array(512);

  constructor(world: SimulationWorld) {
    this.world = world;
    const e = world.env.params;
    this.hash = new SpatialHash(-e.sizeX / 2, 0, -e.sizeZ / 2, e.sizeX, e.sizeY, e.sizeZ, 4);
  }

  create(species: number, x: number, y: number, z: number, ax: number, ay: number, az: number, halfLength: number): Bacterium {
    const w = this.world;
    const sp = w.species[species];
    const b = new Bacterium();
    b.id = w.nextCellId++;
    b.species = species;
    b.radius = sp.radius;
    b.halfLength = halfLength;
    b.x = x;
    b.y = y;
    b.z = z;
    const l = Math.hypot(ax, ay, az) || 1;
    b.ax = ax / l;
    b.ay = ay / l;
    b.az = az / l;
    b.bornTime = w.time;
    w.bacteria.push(b);
    return b;
  }

  /** Per-step biology: growth, division, dormancy switching, background death, ghost cleanup. */
  update(dt: number): void {
    const w = this.world;
    const env = w.env;
    const list = w.bacteria;
    const rng = w.rng;
    const dormancy = env.params.dormancyThreshold;
    const n0 = list.length;
    for (let i = 0; i < n0; i++) {
      const b = list[i];
      if (b.state === BacteriaState.Dead) continue;
      const sp = w.species[b.species];
      const voxel = env.voxelIndex(b.x, b.y, b.z);

      if (b.state !== BacteriaState.Infected) {
        // background death
        if (rng.next() < sp.deathRate * dt) {
          this.kill(b, DeathCause.Natural);
          continue;
        }
        let f = env.growthFactor(voxel);
        if (b.resistant) f *= 1 - sp.resistanceCost;
        b.activity = f;
        if (b.state === BacteriaState.Susceptible && f < dormancy) {
          b.state = BacteriaState.Inactive;
          w.emit(SimEventType.CellDormant, b.id, -1, b.x, b.y, b.z, 0, false);
        } else if (b.state === BacteriaState.Inactive && f > dormancy * 1.6) {
          b.state = BacteriaState.Susceptible;
          w.emit(SimEventType.CellReactivated, b.id, -1, b.x, b.y, b.z, 0, false);
        }
        if (b.state === BacteriaState.Inactive) continue;

        // exponential volume growth: dV = μ V dt
        const mu = sp.growthRateMax * f;
        const vol = capsuleVolume(b.halfLength, b.radius);
        const dV = mu * vol * dt;
        b.halfLength += dV / (2 * Math.PI * b.radius * b.radius);
        env.consume(voxel, (env.params.nutrientUptake * mu * dt) / Math.LN2);

        if (b.halfLength >= sp.divisionHalfLength && list.length < w.config.maxBacteria) {
          this.divide(b);
        } else if (b.halfLength > sp.divisionHalfLength * 1.15) {
          b.halfLength = sp.divisionHalfLength * 1.15; // crowded: growth arrested by space
        }
      }
    }

    // remove ghosts of dead cells
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (b.state !== BacteriaState.Dead) continue;
      const linger = b.deathCause === DeathCause.Lysis ? GHOST_LYSIS : GHOST_NATURAL;
      if (w.time - b.deathTime > linger) {
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
  }

  kill(b: Bacterium, cause: DeathCause): void {
    b.state = BacteriaState.Dead;
    b.deathCause = cause;
    b.deathTime = this.world.time;
    b.stage = InfectionStage.None;
    if (cause === DeathCause.Natural) {
      this.world.counters.naturalDeaths++;
      this.world.emit(SimEventType.CellDeath, b.id, -1, b.x, b.y, b.z, 0, false);
    } else {
      this.world.counters.lysedCells++;
    }
  }

  private divide(b: Bacterium): void {
    const w = this.world;
    const rng = w.rng;
    const sp = w.species[b.species];
    const r = b.radius;
    const half = capsuleVolume(b.halfLength, r) / 2;
    const hd = Math.max(0, (half - (4 / 3) * Math.PI * r * r * r) / (2 * Math.PI * r * r));
    const off = hd + r;
    const cx = b.x;
    const cy = b.y;
    const cz = b.z;
    const ax = b.ax;
    const ay = b.ay;
    const az = b.az;

    // mother becomes daughter 1 (keeps id lineage simple), daughter 2 is new
    b.x = cx - ax * off;
    b.y = cy - ay * off;
    b.z = cz - az * off;
    b.halfLength = hd;
    b.bornTime = w.time;
    jitterAxis(b, rng.normal() * 0.08, rng.normal() * 0.08, rng.normal() * 0.08);

    const d = this.create(b.species, cx + ax * off, cy + ay * off, cz + az * off, ax, ay, az, hd);
    d.parentId = b.id;
    d.resistant = b.resistant;
    d.state = b.resistant ? BacteriaState.Resistant : BacteriaState.Susceptible;
    d.activity = b.activity;
    jitterAxis(d, rng.normal() * 0.08, rng.normal() * 0.08, rng.normal() * 0.08);
    w.counters.divisions++;
    w.emit(SimEventType.CellDivision, b.id, d.id, cx, cy, cz, 0, false);

    if (!d.resistant && sp.resistanceMutation > 0 && rng.next() < sp.resistanceMutation) {
      d.resistant = true;
      d.state = BacteriaState.Resistant;
      w.counters.resistanceMutations++;
      w.emit(SimEventType.ResistanceEmerged, d.id, b.id, d.x, d.y, d.z, 0, false);
    }
  }

  /** Rebuild the spatial index (call once per step before neighbour queries). */
  rebuildIndex(): void {
    const list = this.world.bacteria;
    const n = list.length;
    if (this.xs.length < n) {
      const cap = Math.max(256, n * 2);
      this.xs = new Float64Array(cap);
      this.ys = new Float64Array(cap);
      this.zs = new Float64Array(cap);
    }
    for (let i = 0; i < n; i++) {
      this.xs[i] = list[i].x;
      this.ys[i] = list[i].y;
      this.zs[i] = list[i].z;
    }
    this.hash.build(n, this.xs, this.ys, this.zs);
  }

  /**
   * Soft-contact relaxation between capsules, settling onto the mucus surface,
   * and confinement to the compartment.
   */
  mechanics(dt: number): void {
    const w = this.world;
    const list = w.bacteria;
    const n = list.length;
    if (this.push.length < n * 6) this.push = new Float64Array(Math.max(1536, n * 12));
    const acc = this.push;
    acc.fill(0, 0, n * 6);
    this.rebuildIndex();
    const pair = this.pair;

    for (let i = 0; i < n; i++) {
      const a = list[i];
      if (a.state === BacteriaState.Dead) continue;
      const reach = a.halfLength + a.radius + 2.1;
      const found = this.hash.queryInto(a.x, a.y, a.z, reach, this.near);
      for (let q = 0; q < found; q++) {
        const j = this.near[q];
        if (j <= i) continue;
        const b = list[j];
        if (b.state === BacteriaState.Dead) continue;
        const minD = a.radius + b.radius;
        const lim = a.halfLength + b.halfLength + minD;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        if (dx * dx + dy * dy + dz * dz > lim * lim) continue;
        const d2 = segmentSegment(a.x, a.y, a.z, a.ax, a.ay, a.az, a.halfLength, b.x, b.y, b.z, b.ax, b.ay, b.az, b.halfLength, pair);
        if (d2 >= minD * minD) continue;
        const s = pair[0];
        const t = pair[1];
        // contact normal from A's closest point to B's closest point
        let nx = b.x + b.ax * t - (a.x + a.ax * s);
        let ny = b.y + b.ay * t - (a.y + a.ay * s);
        let nz = b.z + b.az * t - (a.z + a.az * s);
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          // perfectly overlapping axes: separate deterministically along x/z
          nx = (i & 1) === 0 ? 1 : -1;
          ny = 0;
          nz = 0.3;
          d = 1;
        } else {
          nx /= d;
          ny /= d;
          nz /= d;
        }
        const overlap = (minD - Math.sqrt(d2)) * 0.5;
        accumulate(acc, i, a, s, -nx * overlap, -ny * overlap, -nz * overlap);
        accumulate(acc, j, b, t, nx * overlap, ny * overlap, nz * overlap);
      }
    }

    const e = w.env.params;
    const hx = e.sizeX / 2;
    const hz = e.sizeZ / 2;
    const settle = 0.02 * dt;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      if (b.state === BacteriaState.Dead) continue;
      const o = i * 6;
      b.x += acc[o] * 0.8;
      b.y += acc[o + 1] * 0.8 - settle;
      b.z += acc[o + 2] * 0.8;
      // rotate axis by the accumulated perpendicular push
      let ax = b.ax + acc[o + 3] * 0.8;
      let ay = (b.ay + acc[o + 4] * 0.8) * 0.995; // cells tend to lie flat on the surface
      let az = b.az + acc[o + 5] * 0.8;
      const l = Math.hypot(ax, ay, az) || 1;
      ax /= l;
      ay /= l;
      az /= l;
      b.ax = ax;
      b.ay = ay;
      b.az = az;
      // floor: the lower end of the capsule must stay above the surface
      const lowest = b.y - Math.abs(b.ay) * b.halfLength - b.radius;
      if (lowest < 0) {
        b.y -= lowest;
        b.ay *= 0.9;
        const l2 = Math.hypot(b.ax, b.ay, b.az) || 1;
        b.ax /= l2;
        b.ay /= l2;
        b.az /= l2;
      }
      const top = e.sizeY - b.radius;
      if (b.y > top) b.y = top;
      const mx = hx - b.radius - b.halfLength * Math.abs(b.ax);
      const mz = hz - b.radius - b.halfLength * Math.abs(b.az);
      if (b.x < -mx) b.x = -mx;
      else if (b.x > mx) b.x = mx;
      if (b.z < -mz) b.z = -mz;
      else if (b.z > mz) b.z = mz;
    }
  }
}

function accumulate(acc: Float64Array, i: number, c: Bacterium, s: number, fx: number, fy: number, fz: number): void {
  const o = i * 6;
  acc[o] += fx;
  acc[o + 1] += fy;
  acc[o + 2] += fz;
  if (c.halfLength > 1e-4) {
    // torque from an off-centre push: rotate axis toward the force at lever s
    const k = s / (c.halfLength * c.halfLength + c.radius * c.radius) * 0.5;
    const dot = fx * c.ax + fy * c.ay + fz * c.az;
    acc[o + 3] += (fx - c.ax * dot) * k;
    acc[o + 4] += (fy - c.ay * dot) * k;
    acc[o + 5] += (fz - c.az * dot) * k;
  }
}

function jitterAxis(b: Bacterium, dx: number, dy: number, dz: number): void {
  let ax = b.ax + dx;
  let ay = b.ay + dy * 0.3;
  let az = b.az + dz;
  const l = Math.hypot(ax, ay, az) || 1;
  b.ax = ax / l;
  b.ay = ay / l;
  b.az = az / l;
}
