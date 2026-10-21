import { SimEventType } from '../../core/EventQueue';
import type { SimulationWorld } from '../../core/SimulationWorld';
import { BacteriaState } from '../bacteria/Bacterium';
import { capsuleVolume, pointToCell } from '../CellGeometry';
import { PhageAgent } from './PhageAgent';

/** Thickness of the encounter shell around a cell in which adsorption can occur (µm). */
export const CAPTURE_SHELL = 0.6;

/**
 * Detail-mode phages: Brownian motion, encounter-based adsorption and decay.
 * The adsorption hazard inside the encounter shell is k / V_shell, which makes
 * the mean rate match the mass-action rate k·[B] used by the population model.
 */
export class PhageSystem {
  readonly world: SimulationWorld;
  private readonly hit = [0, 0, 0, 0, 0];
  private readonly near = new Int32Array(256);
  private readonly candidates = new Int32Array(64);
  private readonly weights = new Float64Array(64);

  constructor(world: SimulationWorld) {
    this.world = world;
  }

  create(x: number, y: number, z: number, parentId: number, generation: number, lineage: boolean): PhageAgent {
    const w = this.world;
    const p = new PhageAgent();
    p.id = w.nextPhageId++;
    p.x = p.px = x;
    p.y = p.py = y;
    p.z = p.pz = z;
    p.parentId = parentId;
    p.generation = generation;
    p.lineage = lineage;
    p.bornTime = w.time;
    w.phages.push(p);
    return p;
  }

  update(dt: number): void {
    const w = this.world;
    const rng = w.rng;
    const pp = w.phageParams;
    const e = w.env.params;
    const hx = e.sizeX / 2;
    const hz = e.sizeZ / 2;
    const sigma = Math.sqrt(2 * pp.diffusion * dt);
    const bacteria = w.bacteria;
    const hash = w.bacteriaSystem.hash;
    const hit = this.hit;
    const list = w.phages;
    const k = pp.adsorptionRate;

    // decay: sample how many, then which (cheaper than one draw per particle)
    const nDecay = rng.binomial(list.length, 1 - Math.exp(-pp.decayRate * dt));
    for (let d = 0; d < nDecay && list.length > 0; d++) {
      const idx = rng.int(list.length);
      const p = list[idx];
      w.counters.decayed++;
      w.emit(SimEventType.PhageDecayed, p.id, -1, p.x, p.y, p.z, 0, p.id === w.trackedPhageId);
      this.removeAt(idx);
      w.onPhageLost(p);
    }

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      let x = p.x + sigma * rng.normal();
      let y = p.y + sigma * rng.normal();
      let z = p.z + sigma * rng.normal();
      // reflective boundaries (mucus surface below, lumen ceiling above)
      if (x < -hx) x = -2 * hx - x;
      else if (x > hx) x = 2 * hx - x;
      if (z < -hz) z = -2 * hz - z;
      else if (z > hz) z = 2 * hz - z;
      if (y < 0.05) y = 0.1 - y;
      else if (y > e.sizeY) y = 2 * e.sizeY - y;

      // encounter shell test against nearby cells
      const cands = this.candidates;
      const wts = this.weights;
      let nc = 0;
      let hazard = 0;
      const found = hash.queryInto(x, y, z, 2.8, this.near);
      for (let q = 0; q < found; q++) {
        const j = this.near[q];
        const c = bacteria[j];
        if (c.state === BacteriaState.Dead) continue;
        // cheap bounding test before the exact segment distance
        const reach = c.halfLength + c.radius + CAPTURE_SHELL;
        const dx = x - c.x;
        const dy = y - c.y;
        const dz = z - c.z;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        pointToCell(c, x, y, z, hit);
        const shell = c.radius + CAPTURE_SHELL;
        if (hit[1] >= shell * shell) continue;
        if (hit[1] < c.radius * c.radius) {
          // inside the cell: push back out to the surface
          const dist = Math.sqrt(hit[1]);
          if (dist > 1e-6) {
            const s = (c.radius + 0.04) / dist;
            x = c.x + c.ax * hit[0] + hit[2] * s;
            y = c.y + c.ay * hit[0] + hit[3] * s;
            z = c.z + c.az * hit[0] + hit[4] * s;
          }
        }
        if (!w.canAdsorb(c)) continue;
        const vShell = capsuleVolume(c.halfLength, shell) - capsuleVolume(c.halfLength, c.radius);
        const h = k / vShell;
        hazard += h;
        cands[nc] = j;
        wts[nc] = h;
        nc++;
      }
      p.x = x;
      p.y = y;
      p.z = z;

      if (hazard > 0 && rng.next() < 1 - Math.exp(-hazard * dt)) {
        let pick = rng.next() * hazard;
        let target = cands[nc - 1];
        for (let c = 0; c < nc; c++) {
          pick -= wts[c];
          if (pick <= 0) {
            target = cands[c];
            break;
          }
        }
        this.removeAt(i);
        i--;
        w.adsorb(bacteria[target], p.id, p.generation, p.x, p.y, p.z);
      }
    }
  }

  /** Swap-remove; order changes are deterministic. */
  removeAt(i: number): void {
    const list = this.world.phages;
    list[i] = list[list.length - 1];
    list.pop();
  }

  indexOf(id: number): number {
    const list = this.world.phages;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }
}
