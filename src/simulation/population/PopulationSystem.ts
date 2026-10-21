import type { SimulationWorld } from '../../core/SimulationWorld';
import { BacteriaState } from '../bacteria/Bacterium';
import { attachPoint, pointToCell } from '../CellGeometry';

/**
 * Population mode for distant free phages (design §4.1): integer counts per voxel
 * with stochastic diffusion hops, decay and mass-action adsorption k·N·B/V.
 * Rebalancing converts between individuals and counts while conserving totals.
 */
export class PopulationSystem {
  readonly world: SimulationWorld;
  counts: Int32Array;
  total = 0;
  private hops: Int32Array;
  /** Per-voxel lists of cells phages may adsorb to (rebuilt each population step). */
  private voxelCells: number[][];
  private readonly tmp = [0, 0, 0, 0, 0, 0];
  private readonly hit = [0, 0, 0, 0, 0];
  private order: number[] = [];
  private readonly near = new Int32Array(256);
  private dist: Float64Array = new Float64Array(0);

  constructor(world: SimulationWorld) {
    this.world = world;
    const n = world.env.voxelCount;
    this.counts = new Int32Array(n);
    this.hops = new Int32Array(n);
    this.voxelCells = [];
    for (let i = 0; i < n; i++) this.voxelCells.push([]);
  }

  add(voxel: number, n: number): void {
    this.counts[voxel] += n;
    this.total += n;
  }

  recount(): void {
    let t = 0;
    for (let i = 0; i < this.counts.length; i++) t += this.counts[i];
    this.total = t;
  }

  update(dt: number): void {
    if (this.total === 0) return;
    const w = this.world;
    const env = w.env;
    const rng = w.rng;
    const pp = w.phageParams;
    const counts = this.counts;
    const nVox = counts.length;

    // candidate host cells per voxel
    for (let v = 0; v < nVox; v++) this.voxelCells[v].length = 0;
    const cells = w.bacteria;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.state === BacteriaState.Dead || !w.canAdsorb(c)) continue;
      this.voxelCells[env.voxelIndex(c.x, c.y, c.z)].push(i);
    }

    const pDecay = 1 - Math.exp(-pp.decayRate * dt);
    const pHop = Math.min(1 / 6, (pp.diffusion * dt) / (env.params.voxelSize * env.params.voxelSize));
    const tmp = this.tmp;
    this.hops.fill(0);

    for (let v = 0; v < nVox; v++) {
      let n = counts[v];
      if (n === 0) continue;
      // decay
      const dead = rng.binomial(n, pDecay);
      n -= dead;
      w.counters.decayed += dead;
      // adsorption (mass action within the voxel)
      const hosts = this.voxelCells[v];
      if (hosts.length > 0 && n > 0) {
        const pAds = 1 - Math.exp(-(pp.adsorptionRate * hosts.length * dt) / env.voxelVolume);
        const ads = rng.binomial(n, pAds);
        n -= ads;
        for (let a = 0; a < ads; a++) {
          const c = cells[hosts[rng.int(hosts.length)]];
          attachPoint(c, rng.range(-1, 1), rng.range(0, Math.PI * 2), tmp);
          w.adsorb(c, -1, -1, tmp[0], tmp[1], tmp[2]);
        }
      }
      // diffusion hops to the 6 neighbours (reflective at the boundary)
      const moving = rng.binomial(n, pHop * 6);
      let left = moving;
      for (let d = 0; d < 6 && left > 0; d++) {
        const m = d === 5 ? left : rng.binomial(left, 1 / (6 - d));
        left -= m;
        const j = env.neighbor(v, d);
        if (j >= 0) {
          this.hops[j] += m;
          n -= m;
        }
      }
      counts[v] = n;
    }
    for (let v = 0; v < nVox; v++) counts[v] += this.hops[v];
    this.recount();
  }

  /**
   * Keep the number of individuals within budget: demote far, unprotected individuals
   * into voxel counts, and promote counts near the focus into individuals.
   */
  rebalance(): void {
    const w = this.world;
    const budget = w.config.detailBudget;
    const list = w.phages;
    const focus = w.focusPoint();
    const fx = focus[0];
    const fy = focus[1];
    const fz = focus[2];

    if (list.length > budget) {
      const excess = list.length - Math.floor(budget * 0.9);
      const order = this.order;
      order.length = 0;
      if (this.dist.length < list.length) this.dist = new Float64Array(list.length * 2);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.lineage || p.id === w.trackedPhageId) continue;
        this.dist[i] = (p.x - fx) ** 2 + (p.y - fy) ** 2 + (p.z - fz) ** 2;
        order.push(i);
      }
      // farthest first; ties broken by index for determinism
      order.sort((a, b) => this.dist[b] - this.dist[a] || a - b);
      const remove = order.slice(0, Math.min(excess, order.length)).sort((a, b) => b - a);
      for (const i of remove) {
        const p = list[i];
        this.add(w.env.voxelIndex(p.x, p.y, p.z), 1);
        w.phageSystem.removeAt(i);
      }
      return;
    }

    if (this.total > 0 && list.length < budget * 0.75) {
      let room = Math.floor(budget * 0.85) - list.length;
      const env = w.env;
      const voxels: number[] = [];
      const vd: number[] = [];
      const o = [0, 0, 0];
      const s = env.params.voxelSize;
      for (let v = 0; v < this.counts.length; v++) {
        if (this.counts[v] === 0) continue;
        env.voxelOrigin(v, o);
        vd[v] = (o[0] + s / 2 - fx) ** 2 + (o[1] + s / 2 - fy) ** 2 + (o[2] + s / 2 - fz) ** 2;
        voxels.push(v);
      }
      voxels.sort((a, b) => vd[a] - vd[b] || a - b);
      const rng = w.rng;
      const ySize = env.params.sizeY;
      for (const v of voxels) {
        if (room <= 0) break;
        const k = Math.min(room, this.counts[v]);
        env.voxelOrigin(v, o);
        for (let i = 0; i < k; i++) {
          const x = o[0] + rng.next() * s;
          const y = Math.min(ySize - 0.05, Math.max(0.1, o[1] + rng.next() * s));
          const z = o[2] + rng.next() * s;
          this.pushOutOfCells(x, y, z, o);
          w.phageSystem.create(o[0], o[1], o[2], -1, -1, false);
          // restore voxel origin for next sample
          env.voxelOrigin(v, o);
        }
        this.counts[v] -= k;
        this.total -= k;
        room -= k;
      }
    }
  }

  /** Writes a position outside any cell into out (spawned individuals must not start inside a cell). */
  private pushOutOfCells(x: number, y: number, z: number, out: number[]): void {
    const w = this.world;
    const hit = this.hit;
    const cells = w.bacteria;
    const found = w.bacteriaSystem.hash.queryInto(x, y, z, 2.2, this.near);
    for (let q = 0; q < found; q++) {
      const j = this.near[q];
      const c = cells[j];
      if (c.state === BacteriaState.Dead) continue;
      pointToCell(c, x, y, z, hit);
      if (hit[1] < c.radius * c.radius) {
        const d = Math.sqrt(hit[1]);
        const s = d > 1e-6 ? (c.radius + 0.05) / d : 0;
        if (s > 0) {
          x = c.x + c.ax * hit[0] + hit[2] * s;
          y = c.y + c.ay * hit[0] + hit[3] * s;
          z = c.z + c.az * hit[0] + hit[4] * s;
        } else {
          y = c.y + c.radius + 0.05;
        }
      }
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
  }
}
