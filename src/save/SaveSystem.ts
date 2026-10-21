import { BacteriaState, Bacterium, DeathCause, InfectionStage } from '../simulation/bacteria/Bacterium';
import { PhageAgent } from '../simulation/phage/PhageAgent';
import { SimEvent } from '../core/EventQueue';
import { Command, LineageRecord, SimulationWorld, StatsSample, WorldCounters } from '../core/SimulationWorld';
import { MODEL_VERSION, SimulationConfig } from '../core/SimulationConfig';

/** Bump when the layout changes; older saves are migrated or rejected. */
export const SAVE_VERSION = 1;

/**
 * Versioned snapshot of the authoritative simulation state (design §6: バージョン付きシリアライズ).
 * Entities are stored as flat number arrays to keep files small and the format
 * trivially portable to a C# reader.
 */
export interface SaveData {
  format: 'phage-inner-world';
  version: number;
  modelVersion: string;
  savedAt: string;
  config: SimulationConfig;
  rng: number[];
  step: number;
  time: number;
  nextCellId: number;
  nextPhageId: number;
  introduced: boolean;
  trackedPhageId: number;
  trackedHostId: number;
  lineage: LineageRecord[];
  counters: WorldCounters;
  milestones: number;
  initialHosts: number;
  peakHosts: number;
  history: StatsSample[];
  commands: Command[];
  events: SimEvent[];
  nutrient: number[];
  population: number[];
  /** Bacteria, BACTERIA_FIELDS numbers per cell. */
  bacteria: number[];
  /** Phages, PHAGE_FIELDS numbers per particle. */
  phages: number[];
  /** Verification hash of the state at save time. */
  hash: string;
}

const BACTERIA_FIELDS = 26;
const PHAGE_FIELDS = 11;

export function serialize(w: SimulationWorld): SaveData {
  const bacteria: number[] = [];
  for (const b of w.bacteria) {
    bacteria.push(
      b.id, b.species, b.state, b.resistant ? 1 : 0, b.x, b.y, b.z, b.ax, b.ay, b.az, b.halfLength, b.radius,
      b.activity, b.bornTime, b.parentId, b.deathCause, b.deathTime, b.stage, b.infTime, b.latent, b.burst,
      b.founderId, b.founderGeneration, b.founderLineage ? 1 : 0, b.attachU, b.attachTheta,
    );
    // excluded count is appended separately to keep the stride documented
  }
  const excluded = w.bacteria.map((b) => b.excluded);
  const phages: number[] = [];
  for (const p of w.phages) {
    phages.push(p.id, p.x, p.y, p.z, p.px, p.py, p.pz, p.parentId, p.generation, p.lineage ? 1 : 0, p.bornTime);
  }
  return {
    format: 'phage-inner-world',
    version: SAVE_VERSION,
    modelVersion: MODEL_VERSION,
    savedAt: new Date().toISOString(),
    config: { ...w.config },
    rng: w.rng.getState(),
    step: w.step,
    time: w.time,
    nextCellId: w.nextCellId,
    nextPhageId: w.nextPhageId,
    introduced: w.introduced,
    trackedPhageId: w.trackedPhageId,
    trackedHostId: w.trackedHostId,
    lineage: w.lineage.map((r) => ({ ...r })),
    counters: { ...w.counters },
    milestones: w.milestones,
    initialHosts: w.initialHosts,
    peakHosts: w.peakHosts,
    history: w.history.map((h) => ({ ...h })),
    commands: w.commands.map((c) => ({ ...c })),
    events: w.events.history.map((e) => ({ ...e })),
    nutrient: Array.from(w.env.nutrient),
    population: Array.from(w.population.counts),
    bacteria: bacteria.concat(excluded),
    phages,
    hash: w.stateHash(),
  };
}

export function deserialize(data: SaveData): SimulationWorld {
  if (data.format !== 'phage-inner-world') throw new Error('Not a PHAGE: Inner World save file');
  if (data.version > SAVE_VERSION) throw new Error(`Save version ${data.version} is newer than this build (${SAVE_VERSION})`);
  const w = new SimulationWorld(data.config, false);
  w.rng.setState(data.rng);
  w.step = data.step;
  w.time = data.time;
  w.nextCellId = data.nextCellId;
  w.nextPhageId = data.nextPhageId;
  w.introduced = data.introduced;
  w.trackedPhageId = data.trackedPhageId;
  w.trackedHostId = data.trackedHostId;
  w.lineage = data.lineage.map((r) => ({ ...r }));
  w.counters = { ...data.counters };
  w.milestones = data.milestones;
  w.initialHosts = data.initialHosts;
  w.peakHosts = data.peakHosts;
  w.history = data.history.map((h) => ({ ...h }));
  w.commands = data.commands.map((c) => ({ ...c }));
  for (const e of data.events) w.events.history.push({ ...e });
  w.env.nutrient.set(data.nutrient);
  w.population.counts.set(data.population);
  w.population.recount();

  const nCells = data.bacteria.length / (BACTERIA_FIELDS + 1);
  const a = data.bacteria;
  for (let i = 0; i < nCells; i++) {
    const o = i * BACTERIA_FIELDS;
    const b = new Bacterium();
    b.id = a[o];
    b.species = a[o + 1];
    b.state = a[o + 2] as BacteriaState;
    b.resistant = a[o + 3] === 1;
    b.x = a[o + 4];
    b.y = a[o + 5];
    b.z = a[o + 6];
    b.ax = a[o + 7];
    b.ay = a[o + 8];
    b.az = a[o + 9];
    b.halfLength = a[o + 10];
    b.radius = a[o + 11];
    b.activity = a[o + 12];
    b.bornTime = a[o + 13];
    b.parentId = a[o + 14];
    b.deathCause = a[o + 15] as DeathCause;
    b.deathTime = a[o + 16];
    b.stage = a[o + 17] as InfectionStage;
    b.infTime = a[o + 18];
    b.latent = a[o + 19];
    b.burst = a[o + 20];
    b.founderId = a[o + 21];
    b.founderGeneration = a[o + 22];
    b.founderLineage = a[o + 23] === 1;
    b.attachU = a[o + 24];
    b.attachTheta = a[o + 25];
    b.excluded = a[nCells * BACTERIA_FIELDS + i];
    w.bacteria.push(b);
  }
  const ph = data.phages;
  for (let o = 0; o < ph.length; o += PHAGE_FIELDS) {
    const p = new PhageAgent();
    p.id = ph[o];
    p.x = ph[o + 1];
    p.y = ph[o + 2];
    p.z = ph[o + 3];
    p.px = ph[o + 4];
    p.py = ph[o + 5];
    p.pz = ph[o + 6];
    p.parentId = ph[o + 7];
    p.generation = ph[o + 8];
    p.lineage = ph[o + 9] === 1;
    p.bornTime = ph[o + 10];
    w.phages.push(p);
  }
  w.bacteriaSystem.rebuildIndex();
  return w;
}

// ---------------------------------------------------------------- storage

const SLOT_PREFIX = 'phage-inner-world/slot/';

export interface SlotInfo {
  slot: number;
  savedAt: string;
  time: number;
  phageId: string;
  free: number;
  hosts: number;
}

export function saveToSlot(w: SimulationWorld, slot: number): boolean {
  try {
    const data = serialize(w);
    localStorage.setItem(SLOT_PREFIX + slot, JSON.stringify(data));
    localStorage.setItem(
      SLOT_PREFIX + slot + '/meta',
      JSON.stringify({ slot, savedAt: data.savedAt, time: w.time, phageId: w.config.phageId, free: w.freePhageTotal(), hosts: w.countHosts() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadFromSlot(slot: number): SimulationWorld | null {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + slot);
    if (!raw) return null;
    return deserialize(JSON.parse(raw) as SaveData);
  } catch {
    return null;
  }
}

export function slotInfo(slot: number): SlotInfo | null {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + slot + '/meta');
    return raw ? (JSON.parse(raw) as SlotInfo) : null;
  } catch {
    return null;
  }
}

export function downloadSave(w: SimulationWorld): void {
  const blob = new Blob([JSON.stringify(serialize(w))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `phage-inner-world_${w.config.phageId}_t${Math.round(w.time)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
