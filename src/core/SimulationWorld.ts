import { BacteriaState, Bacterium, InfectionStage } from '../simulation/bacteria/Bacterium';
import { BacteriaSystem } from '../simulation/bacteria/BacteriaSystem';
import { attachCoords } from '../simulation/CellGeometry';
import { EnvironmentSystem } from '../simulation/environment/EnvironmentSystem';
import { InfectionSystem } from '../simulation/infection/InfectionSystem';
import { PhageAgent, PhageState } from '../simulation/phage/PhageAgent';
import { PhageSystem } from '../simulation/phage/PhageSystem';
import { PopulationSystem } from '../simulation/population/PopulationSystem';
import { EventQueue, MilestoneKind, SimEventType } from './EventQueue';
import { Random } from './Random';
import {
  ENVIRONMENT_SPEC,
  getPhageSpec,
  ResolvedPhageParams,
  ResolvedSpeciesParams,
  resolveEnvironment,
  resolvePhage,
  resolveSpecies,
  SimulationConfig,
  SPECIES_SPECS,
} from './SimulationConfig';

export interface WorldCounters {
  introduced: number;
  released: number;
  adsorbed: number;
  decayed: number;
  excluded: number;
  infections: number;
  lysedCells: number;
  naturalDeaths: number;
  divisions: number;
  resistanceMutations: number;
}

export type LineageKind = 'introduced' | 'progeny' | 'sibling' | 'manual';

/** One link of the tracked phage's ancestry (design §4.1: lineage is kept even after aggregation). */
export interface LineageRecord {
  kind: LineageKind;
  generation: number;
  phageId: number;
  parentId: number;
  hostId: number;
  bornTime: number;
  adsorbTime: number;
  lysisTime: number;
  burst: number;
}

export interface StatsSample {
  t: number;
  freeIndividual: number;
  freePopulation: number;
  intracellular: number;
  susceptible: number;
  infected: number;
  resistant: number;
  inactive: number;
  nonHost: number;
  lysedTotal: number;
}

export enum CommandType {
  Introduce = 0,
  Track = 1,
}

/** User inputs that affect the computation. Logged so a run can be replayed exactly. */
export interface Command {
  step: number;
  type: CommandType;
  a: number;
  b: number;
  c: number;
}

export interface TrackedInfo {
  state: PhageState;
  phageId: number;
  generation: number;
  x: number;
  y: number;
  z: number;
  hostId: number;
  host: Bacterium | null;
  phage: PhageAgent | null;
}

/**
 * Owns the authoritative biological state. Has no dependency on rendering:
 * the 3D layer reads from it and never writes to it (design §2 rule).
 */
export class SimulationWorld {
  readonly config: SimulationConfig;
  readonly rng: Random;
  readonly events = new EventQueue();
  readonly env: EnvironmentSystem;
  readonly species: ResolvedSpeciesParams[];
  readonly phageParams: ResolvedPhageParams;
  readonly bacteriaSystem: BacteriaSystem;
  readonly phageSystem: PhageSystem;
  readonly infection: InfectionSystem;
  readonly population: PopulationSystem;

  bacteria: Bacterium[] = [];
  phages: PhageAgent[] = [];
  step = 0;
  time = 0;
  nextCellId = 1;
  nextPhageId = 1;
  introduced = false;
  trackedPhageId = -1;
  trackedHostId = -1;
  lineage: LineageRecord[] = [];
  counters: WorldCounters = {
    introduced: 0,
    released: 0,
    adsorbed: 0,
    decayed: 0,
    excluded: 0,
    infections: 0,
    lysedCells: 0,
    naturalDeaths: 0,
    divisions: 0,
    resistanceMutations: 0,
  };
  milestones = 0;
  history: StatsSample[] = [];
  commands: Command[] = [];
  initialHosts = 0;
  peakHosts = 0;
  private lastFocus = [0, 4, 0];
  private hostMask: boolean[];
  private readonly coords = [0, 0];

  constructor(config: SimulationConfig, populate = true) {
    this.config = config;
    this.rng = new Random(config.seed);
    this.env = new EnvironmentSystem(resolveEnvironment(ENVIRONMENT_SPEC));
    this.species = SPECIES_SPECS.map(resolveSpecies);
    this.phageParams = resolvePhage(getPhageSpec(config.phageId));
    this.hostMask = this.species.map((_, i) => this.phageParams.hostSpecies.includes(i));
    this.bacteriaSystem = new BacteriaSystem(this);
    this.phageSystem = new PhageSystem(this);
    this.infection = new InfectionSystem(this);
    this.population = new PopulationSystem(this);
    if (populate) this.populate();
  }

  // ------------------------------------------------------------------ setup

  private populate(): void {
    const rng = this.rng;
    const cfg = this.config;
    const e = this.env.params;
    const margin = 9;
    const centers: number[][] = [];
    for (let c = 0; c < cfg.colonies; c++) {
      let x = 0;
      let z = 0;
      for (let attempt = 0; attempt < 30; attempt++) {
        x = rng.range(-e.sizeX / 2 + margin, e.sizeX / 2 - margin);
        z = rng.range(-e.sizeZ / 2 + margin, e.sizeZ / 2 - margin);
        if (centers.every((p) => Math.hypot(p[0] - x, p[1] - z) > 16)) break;
      }
      centers.push([x, z]);
    }
    const nonHostColonies = Math.round(cfg.colonies * cfg.incompatibleFraction);
    const perColony = Math.floor(cfg.initialBacteria / cfg.colonies);
    for (let c = 0; c < cfg.colonies; c++) {
      const species = c < nonHostColonies ? this.firstNonHostSpecies() : this.firstHostSpecies();
      const sp = this.species[species];
      const radius = Math.sqrt(perColony) * 0.95;
      for (let k = 0; k < perColony; k++) {
        const a = rng.range(0, Math.PI * 2);
        const r = radius * Math.sqrt(rng.next());
        const x = centers[c][0] + Math.cos(a) * r;
        const z = centers[c][1] + Math.sin(a) * r;
        const dome = Math.max(0, 1 - r / radius);
        const y = sp.radius + rng.next() * dome * 3.2;
        const ang = rng.range(0, Math.PI * 2);
        const h = rng.range(sp.birthHalfLength, sp.divisionHalfLength * 0.95);
        const b = this.bacteriaSystem.create(species, x, y, z, Math.cos(ang), rng.range(-0.15, 0.15), Math.sin(ang), h);
        b.bornTime = -rng.range(0, 1800);
        if (rng.next() < sp.initialResistant) {
          b.resistant = true;
          b.state = BacteriaState.Resistant;
        }
      }
    }
    // relax overlaps before the observation starts
    for (let i = 0; i < 60; i++) this.bacteriaSystem.mechanics(1);
    this.bacteriaSystem.rebuildIndex();
    this.initialHosts = this.countHosts();
    this.peakHosts = this.initialHosts;
    this.sampleHistory();
  }

  private firstHostSpecies(): number {
    return this.hostMask.indexOf(true);
  }

  private firstNonHostSpecies(): number {
    const i = this.hostMask.indexOf(false);
    return i >= 0 ? i : 0;
  }

  // --------------------------------------------------------------- commands

  /** Release the single initial phage at a position (design §7: "1体のファージを投入"). */
  introducePhage(x: number, y: number, z: number): number {
    if (this.introduced) return this.trackedPhageId;
    this.commands.push({ step: this.step, type: CommandType.Introduce, a: x, b: y, c: z });
    return this.applyIntroduce(x, y, z);
  }

  private applyIntroduce(x: number, y: number, z: number): number {
    const e = this.env.params;
    x = Math.max(-e.sizeX / 2, Math.min(e.sizeX / 2, x));
    y = Math.max(0.2, Math.min(e.sizeY, y));
    z = Math.max(-e.sizeZ / 2, Math.min(e.sizeZ / 2, z));
    this.introduced = true;
    const p = this.phageSystem.create(x, y, z, -1, 0, true);
    this.counters.introduced++;
    this.trackedPhageId = p.id;
    this.lineage.push({
      kind: 'introduced', generation: 0, phageId: p.id, parentId: -1, hostId: -1,
      bornTime: this.time, adsorbTime: -1, lysisTime: -1, burst: 0,
    });
    this.emit(SimEventType.PhageIntroduced, p.id, -1, x, y, z, 0, true);
    return p.id;
  }

  /** Switch the tracked phage to another free individual. */
  trackPhage(id: number): boolean {
    if (this.phageSystem.indexOf(id) < 0 || id === this.trackedPhageId) return false;
    this.commands.push({ step: this.step, type: CommandType.Track, a: id, b: 0, c: 0 });
    return this.applyTrack(id, 'manual');
  }

  private applyTrack(id: number, kind: LineageKind): boolean {
    const idx = this.phageSystem.indexOf(id);
    if (idx < 0) return false;
    const p = this.phages[idx];
    this.clearLineageFlags();
    p.lineage = true;
    this.trackedPhageId = id;
    this.trackedHostId = -1;
    this.lineage.push({
      kind, generation: p.generation, phageId: id, parentId: p.parentId, hostId: -1,
      bornTime: p.bornTime, adsorbTime: -1, lysisTime: -1, burst: 0,
    });
    this.emit(SimEventType.TrackingChanged, id, p.parentId, p.x, p.y, p.z, kind === 'manual' ? 2 : 1, true);
    return true;
  }

  // ------------------------------------------------------------------- step

  advance(): void {
    const dt = this.config.dt;
    this.step++;
    this.time += dt;
    const cfg = this.config;

    if (this.step % cfg.populationInterval === 0) this.env.update(dt * cfg.populationInterval);
    this.bacteriaSystem.update(dt);
    if (this.step % cfg.mechanicsInterval === 0) this.bacteriaSystem.mechanics(dt * cfg.mechanicsInterval);
    this.bacteriaSystem.rebuildIndex();
    this.phageSystem.update(dt);
    this.infection.update(dt);
    if (this.step % cfg.populationInterval === 0) this.population.update(dt * cfg.populationInterval);
    if (this.step % cfg.rebalanceInterval === 0) this.population.rebalance();
    if (this.step % 8 === 0) this.checkMilestones();
    if (Math.round(this.time / dt) % Math.round(15 / dt) === 0) this.sampleHistory();
  }

  /** Advance n steps (headless use, tests, replay). */
  run(steps: number): void {
    for (let i = 0; i < steps; i++) this.advance();
  }

  /** Deterministic replay of (config, commands) up to a given step. */
  static replay(config: SimulationConfig, commands: Command[], toStep: number): SimulationWorld {
    const w = new SimulationWorld(config);
    let ci = 0;
    while (w.step < toStep) {
      while (ci < commands.length && commands[ci].step === w.step) {
        const c = commands[ci++];
        if (c.type === CommandType.Introduce) w.introducePhage(c.a, c.b, c.c);
        else w.trackPhage(c.a);
      }
      w.advance();
    }
    while (ci < commands.length && commands[ci].step === w.step) {
      const c = commands[ci++];
      if (c.type === CommandType.Introduce) w.introducePhage(c.a, c.b, c.c);
      else w.trackPhage(c.a);
    }
    return w;
  }

  emit(type: SimEventType, entityId: number, otherId: number, x: number, y: number, z: number, value: number, lineage: boolean): void {
    this.events.push({ type, step: this.step, time: this.time, entityId, otherId, x, y, z, value, lineage });
  }

  // -------------------------------------------------------------- infection

  /** Receptor compatibility: host species, alive, not receptor-deficient. */
  canAdsorb(c: Bacterium): boolean {
    return this.hostMask[c.species] && !c.resistant && c.state !== BacteriaState.Dead;
  }

  isHostSpecies(species: number): boolean {
    return this.hostMask[species];
  }

  /** A phage binds a compatible cell. Already-infected cells exclude the newcomer. */
  adsorb(cell: Bacterium, phageId: number, generation: number, x: number, y: number, z: number): void {
    this.counters.adsorbed++;
    const tracked = phageId >= 0 && phageId === this.trackedPhageId;
    if (cell.state === BacteriaState.Infected) {
      cell.excluded++;
      this.counters.excluded++;
      this.emit(SimEventType.SuperinfectionExcluded, cell.id, phageId, x, y, z, 0, tracked);
      if (tracked) this.onTrackedLost(x, y, z);
      return;
    }
    attachCoords(cell, x, y, z, this.coords);
    this.infection.begin(cell, phageId, generation, tracked, this.coords[0], this.coords[1]);
    this.counters.infections++;
    this.emit(SimEventType.Adsorption, cell.id, phageId, x, y, z, 0, tracked);
    if (tracked) {
      this.trackedHostId = cell.id;
      const rec = this.lineage[this.lineage.length - 1];
      if (rec) {
        rec.hostId = cell.id;
        rec.adsorbTime = this.time;
      }
    }
    if (!this.hasMilestone(MilestoneKind.FirstInfection)) this.milestone(MilestoneKind.FirstInfection, x, y, z);
  }

  onPhageLost(p: PhageAgent): void {
    if (p.id === this.trackedPhageId) this.onTrackedLost(p.x, p.y, p.z);
  }

  /** The tracked particle was inactivated or excluded: follow its nearest sibling if possible. */
  private onTrackedLost(x: number, y: number, z: number): void {
    let best = -1;
    let bestD = Infinity;
    let bestLineage = false;
    for (let i = 0; i < this.phages.length; i++) {
      const p = this.phages[i];
      if (p.id === this.trackedPhageId) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
      // prefer protected siblings over unrelated particles
      if ((p.lineage && !bestLineage) || (p.lineage === bestLineage && d < bestD)) {
        best = i;
        bestD = d;
        bestLineage = p.lineage;
      }
    }
    this.trackedPhageId = -1;
    this.trackedHostId = -1;
    if (best >= 0) {
      this.applyTrack(this.phages[best].id, bestLineage ? 'sibling' : 'manual');
    } else {
      this.milestone(MilestoneKind.LineageLost, x, y, z);
    }
  }

  clearLineageFlags(): void {
    for (let i = 0; i < this.phages.length; i++) this.phages[i].lineage = false;
  }

  /** Called by the infection system when the tracked phage's host bursts. */
  lineageLysis(cell: Bacterium, burst: number, childId: number): void {
    const rec = this.lineage[this.lineage.length - 1];
    if (rec) {
      rec.lysisTime = this.time;
      rec.burst = burst;
    }
    const child = this.phages[this.phageSystem.indexOf(childId)];
    this.trackedPhageId = childId;
    this.trackedHostId = -1;
    this.lineage.push({
      kind: 'progeny', generation: child.generation, phageId: childId, parentId: child.parentId,
      hostId: -1, bornTime: this.time, adsorbTime: -1, lysisTime: -1, burst: 0,
    });
    this.emit(SimEventType.TrackingChanged, childId, cell.id, child.x, child.y, child.z, 0, true);
  }

  /** Where detail mode should be concentrated: the tracked phage or its host. */
  focusPoint(): number[] {
    const t = this.trackedInfo();
    if (t.state !== PhageState.Lost) {
      this.lastFocus[0] = t.x;
      this.lastFocus[1] = t.y;
      this.lastFocus[2] = t.z;
    }
    return this.lastFocus;
  }

  trackedInfo(): TrackedInfo {
    const info: TrackedInfo = {
      state: PhageState.Lost, phageId: this.trackedPhageId, generation: -1,
      x: this.lastFocus[0], y: this.lastFocus[1], z: this.lastFocus[2], hostId: -1, host: null, phage: null,
    };
    if (this.trackedPhageId < 0) return info;
    if (this.trackedHostId < 0) {
      const i = this.phageSystem.indexOf(this.trackedPhageId);
      if (i >= 0) {
        const p = this.phages[i];
        info.state = PhageState.Free;
        info.generation = p.generation;
        info.x = p.x;
        info.y = p.y;
        info.z = p.z;
        info.phage = p;
      }
      return info;
    }
    const host = this.findCell(this.trackedHostId);
    if (host && host.state === BacteriaState.Infected && host.founderId === this.trackedPhageId) {
      info.state = host.stage <= InfectionStage.Injecting ? PhageState.Adsorbed : PhageState.Infected;
      info.generation = host.founderGeneration;
      info.hostId = host.id;
      info.host = host;
      info.x = host.x;
      info.y = host.y;
      info.z = host.z;
    }
    return info;
  }

  findCell(id: number): Bacterium | null {
    for (let i = 0; i < this.bacteria.length; i++) if (this.bacteria[i].id === id) return this.bacteria[i];
    return null;
  }

  // ------------------------------------------------------------------ stats

  countHosts(): number {
    let n = 0;
    for (const b of this.bacteria) if (b.state !== BacteriaState.Dead && this.hostMask[b.species]) n++;
    return n;
  }

  snapshot(): StatsSample {
    const s: StatsSample = {
      t: this.time, freeIndividual: this.phages.length, freePopulation: this.population.total,
      intracellular: 0, susceptible: 0, infected: 0, resistant: 0, inactive: 0, nonHost: 0,
      lysedTotal: this.counters.lysedCells,
    };
    const ecl = this.phageParams.eclipse;
    for (const b of this.bacteria) {
      if (b.state === BacteriaState.Dead) continue;
      if (!this.hostMask[b.species]) {
        s.nonHost++;
        continue;
      }
      switch (b.state) {
        case BacteriaState.Susceptible: s.susceptible++; break;
        case BacteriaState.Infected:
          s.infected++;
          s.intracellular += InfectionSystem.matureCount(b, ecl);
          break;
        case BacteriaState.Resistant: s.resistant++; break;
        case BacteriaState.Inactive: s.inactive++; break;
      }
    }
    return s;
  }

  freePhageTotal(): number {
    return this.phages.length + this.population.total;
  }

  private sampleHistory(): void {
    this.history.push(this.snapshot());
    // keep long runs bounded: halve resolution of the older half
    if (this.history.length > 1600) {
      const keep: StatsSample[] = [];
      const half = this.history.length >> 1;
      for (let i = 0; i < half; i += 2) keep.push(this.history[i]);
      for (let i = half; i < this.history.length; i++) keep.push(this.history[i]);
      this.history = keep;
    }
  }

  hasMilestone(kind: MilestoneKind): boolean {
    return (this.milestones & (1 << kind)) !== 0;
  }

  private milestone(kind: MilestoneKind, x: number, y: number, z: number): void {
    this.milestones |= 1 << kind;
    this.emit(SimEventType.Milestone, -1, -1, x, y, z, kind, false);
  }

  private checkMilestones(): void {
    if (!this.introduced) return;
    const free = this.freePhageTotal();
    const c = this.lastFocus;
    if (this.counters.lysedCells > 0 && !this.hasMilestone(MilestoneKind.FirstLysis)) this.milestone(MilestoneKind.FirstLysis, c[0], c[1], c[2]);
    if (free >= 100 && !this.hasMilestone(MilestoneKind.Phage100)) this.milestone(MilestoneKind.Phage100, c[0], c[1], c[2]);
    if (free >= 1000 && !this.hasMilestone(MilestoneKind.Phage1000)) this.milestone(MilestoneKind.Phage1000, c[0], c[1], c[2]);
    if (free >= 10000 && !this.hasMilestone(MilestoneKind.Phage10000)) this.milestone(MilestoneKind.Phage10000, c[0], c[1], c[2]);
    const hosts = this.countHosts();
    if (hosts > this.peakHosts) this.peakHosts = hosts;
    if (this.counters.lysedCells > 0 && hosts < this.peakHosts * 0.5 && !this.hasMilestone(MilestoneKind.HostHalved)) {
      this.milestone(MilestoneKind.HostHalved, c[0], c[1], c[2]);
    }
    if (this.counters.lysedCells > 0 && hosts < this.peakHosts * 0.1 && !this.hasMilestone(MilestoneKind.HostCollapsed)) {
      this.milestone(MilestoneKind.HostCollapsed, c[0], c[1], c[2]);
    }
    if (this.step % 80 === 0 && !this.hasMilestone(MilestoneKind.ResistantDominant)) {
      const s = this.snapshot();
      const hostsAlive = s.susceptible + s.infected + s.resistant + s.inactive;
      if (hostsAlive > 20 && s.resistant > hostsAlive * 0.5) this.milestone(MilestoneKind.ResistantDominant, c[0], c[1], c[2]);
    }
    if (free === 0 && !this.bacteria.some((b) => b.state === BacteriaState.Infected) && !this.hasMilestone(MilestoneKind.PhageExtinct)) {
      this.milestone(MilestoneKind.PhageExtinct, c[0], c[1], c[2]);
    }
  }

  // ------------------------------------------------------------ verification

  /** Hash of the authoritative state (render-only fields excluded). */
  stateHash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      h ^= v | 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    const q = (v: number): void => mix(Math.round(v * 1000));
    mix(this.step);
    const rs = this.rng.getState();
    for (let i = 0; i < 5; i++) mix(rs[i]);
    q(rs[5]);
    mix(this.nextCellId);
    mix(this.nextPhageId);
    mix(this.trackedPhageId);
    for (const b of this.bacteria) {
      mix(b.id); mix(b.state); mix(b.stage); mix(b.founderId);
      q(b.x); q(b.y); q(b.z); q(b.halfLength); q(b.infTime);
    }
    for (const p of this.phages) {
      mix(p.id); q(p.x); q(p.y); q(p.z);
    }
    for (let i = 0; i < this.population.counts.length; i++) mix(this.population.counts[i]);
    for (let i = 0; i < this.env.nutrient.length; i++) q(this.env.nutrient[i]);
    return h.toString(16).padStart(8, '0');
  }
}
