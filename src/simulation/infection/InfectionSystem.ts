import { SimEventType } from '../../core/EventQueue';
import type { SimulationWorld } from '../../core/SimulationWorld';
import { BacteriaState, Bacterium, DeathCause, InfectionStage } from '../bacteria/Bacterium';
import { attachPoint } from '../CellGeometry';

/**
 * Abstract lytic cycle held by the infected cell (design §3.1):
 * Adsorbing → Injecting → Early (host takeover) → Replication → Assembly → Lysis.
 * Intracellular particles are not simulated individually; the cell holds the stage
 * and the mature-virion count is derived from the timeline.
 */
export class InfectionSystem {
  readonly world: SimulationWorld;
  private readonly tmp = [0, 0, 0, 0, 0, 0];
  private readonly lysing: Bacterium[] = [];

  constructor(world: SimulationWorld) {
    this.world = world;
  }

  /** Start an infection on a susceptible/dormant cell. */
  begin(cell: Bacterium, phageId: number, generation: number, lineage: boolean, u: number, theta: number): void {
    const w = this.world;
    const pp = w.phageParams;
    cell.state = BacteriaState.Infected;
    cell.stage = InfectionStage.Adsorbing;
    cell.infTime = 0;
    cell.founderId = phageId;
    cell.founderGeneration = generation;
    cell.founderLineage = lineage;
    cell.attachU = u;
    cell.attachTheta = theta;
    cell.excluded = 0;
    // host physiology at infection shapes the outcome (slower, smaller bursts in starved cells)
    const a = cell.activity;
    cell.latent = Math.max(pp.eclipse + 120, w.rng.gaussian(pp.latentMean, pp.latentSd));
    cell.burst = Math.max(1, Math.round(w.rng.gaussian(pp.burstMean * (0.35 + 0.65 * a), pp.burstSd * (0.35 + 0.65 * a))));
  }

  /** Infection clock speed relative to real time, from host activity at infection. */
  static clockRate(cell: Bacterium): number {
    return 0.3 + 0.7 * cell.activity;
  }

  update(dt: number): void {
    const w = this.world;
    const pp = w.phageParams;
    const injectEnd = pp.adsorbPhase + pp.injectPhase;
    const list = w.bacteria;
    const lysing = this.lysing;
    lysing.length = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.state !== BacteriaState.Infected) continue;
      // binding and injection run on physical time; intracellular steps on host-scaled time
      const rate = c.stage <= InfectionStage.Injecting ? 1 : InfectionSystem.clockRate(c);
      c.infTime += dt * rate;
      const t = c.infTime;
      const prev = c.stage;
      let next: InfectionStage;
      if (t < pp.adsorbPhase) next = InfectionStage.Adsorbing;
      else if (t < injectEnd) next = InfectionStage.Injecting;
      else if (t < Math.max(injectEnd + 30, pp.eclipse * 0.35)) next = InfectionStage.Early;
      else if (t < pp.eclipse) next = InfectionStage.Replication;
      else next = InfectionStage.Assembly;
      if (next !== prev) {
        c.stage = next;
        if (next === InfectionStage.Early) {
          w.emit(SimEventType.DnaInjection, c.id, c.founderId, c.x, c.y, c.z, 0, c.founderLineage);
        }
      }
      if (t >= c.latent) lysing.push(c);
    }
    for (let i = 0; i < lysing.length; i++) this.lyse(lysing[i]);
  }

  /** Mature virions currently inside the cell (derived, not stored). */
  static matureCount(cell: Bacterium, eclipse: number): number {
    if (cell.state !== BacteriaState.Infected || cell.stage !== InfectionStage.Assembly) return 0;
    const f = (cell.infTime - eclipse) / Math.max(1, cell.latent - eclipse);
    return Math.max(0, Math.min(cell.burst, Math.floor(cell.burst * f)));
  }

  private lyse(c: Bacterium): void {
    const w = this.world;
    const rng = w.rng;
    const n = c.burst;
    const founder = c.founderId;
    const lineage = c.founderLineage;
    const gen = c.founderGeneration >= 0 ? c.founderGeneration + 1 : -1;
    w.bacteriaSystem.kill(c, DeathCause.Lysis);
    w.counters.released += n;
    w.emit(SimEventType.Lysis, c.id, founder, c.x, c.y, c.z, n, lineage);

    const trackedBurst = founder >= 0 && founder === w.trackedPhageId;
    // individuals near the focus / for the tracked lineage, the rest join the voxel population
    const room = w.config.detailBudget - w.phages.length;
    const asIndividuals = trackedBurst ? n : Math.max(0, Math.min(n, room));
    if (trackedBurst) w.clearLineageFlags();
    const tmp = this.tmp;
    const firstIndex = w.phages.length;
    for (let k = 0; k < asIndividuals; k++) {
      // released around the cell surface with a small spread
      attachPoint(c, rng.range(-1, 1), rng.range(0, Math.PI * 2), tmp);
      const spread = rng.range(0.05, 0.9);
      const p = w.phageSystem.create(
        tmp[0] + tmp[3] * spread,
        Math.max(0.1, tmp[1] + tmp[4] * spread),
        tmp[2] + tmp[5] * spread,
        founder,
        gen,
        trackedBurst,
      );
      // render from the cell centre so the burst reads as an explosion
      p.px = c.x;
      p.py = c.y;
      p.pz = c.z;
    }
    const rest = n - asIndividuals;
    if (rest > 0) w.population.add(w.env.voxelIndex(c.x, c.y, c.z), rest);

    if (trackedBurst) {
      const pick = firstIndex + rng.int(asIndividuals);
      w.lineageLysis(c, n, w.phages[pick].id);
    }
  }
}
