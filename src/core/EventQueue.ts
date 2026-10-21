/**
 * Simulation events. The simulation decides *what* happened; the UI and
 * animation layers consume these to decide *how* to show it (design §3.3).
 */
export enum SimEventType {
  PhageIntroduced = 0,
  Adsorption = 1,
  DnaInjection = 2,
  Lysis = 3,
  CellDivision = 4,
  ResistanceEmerged = 5,
  SuperinfectionExcluded = 6,
  CellDeath = 7,
  CellDormant = 8,
  CellReactivated = 9,
  PhageDecayed = 10,
  TrackingChanged = 11,
  Milestone = 12,
}

export enum MilestoneKind {
  FirstInfection = 0,
  FirstLysis = 1,
  Phage100 = 2,
  Phage1000 = 3,
  Phage10000 = 4,
  HostHalved = 5,
  HostCollapsed = 6,
  ResistantDominant = 7,
  PhageExtinct = 8,
  LineageLost = 9,
}

export interface SimEvent {
  type: SimEventType;
  step: number;
  time: number;
  /** Primary entity (cell id or phage id, depending on type). */
  entityId: number;
  /** Secondary entity (e.g. phage id for an adsorption on cell entityId). */
  otherId: number;
  x: number;
  y: number;
  z: number;
  /** Count payload (burst size, milestone kind, ...). */
  value: number;
  /** True when the event belongs to the tracked lineage. */
  lineage: boolean;
}

export class EventQueue {
  private pending: SimEvent[] = [];
  /** Recent notable events kept for the observation log (saved with the world). */
  readonly history: SimEvent[] = [];
  readonly historyLimit = 300;

  push(e: SimEvent): void {
    this.pending.push(e);
    if (isLogWorthy(e)) {
      this.history.push(e);
      if (this.history.length > this.historyLimit) this.history.shift();
    }
  }

  /** Take all events emitted since the last drain. */
  drain(): SimEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  clear(): void {
    this.pending = [];
    this.history.length = 0;
  }
}

/** Frequent, anonymous events are not logged individually. */
export function isLogWorthy(e: SimEvent): boolean {
  switch (e.type) {
    case SimEventType.Milestone:
    case SimEventType.PhageIntroduced:
    case SimEventType.TrackingChanged:
    case SimEventType.ResistanceEmerged:
      return true;
    default:
      return e.lineage;
  }
}
