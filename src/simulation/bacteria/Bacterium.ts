export enum BacteriaState {
  Susceptible = 0,
  Infected = 1,
  Resistant = 2,
  Dead = 3,
  Inactive = 4,
}

/** Stages of the abstract lytic cycle, held by the infected cell (design §3.1). */
export enum InfectionStage {
  None = 0,
  Adsorbing = 1,
  Injecting = 2,
  Early = 3,
  Replication = 4,
  Assembly = 5,
}

export enum DeathCause {
  None = 0,
  Natural = 1,
  Lysis = 2,
}

/**
 * One bacterial cell. Rods and cocci share the same capsule representation:
 * a segment of half length `halfLength` along axis (ax, ay, az) swept by `radius`.
 */
export class Bacterium {
  id = 0;
  species = 0;
  state = BacteriaState.Susceptible;
  /** Receptor-loss genotype; inherited by daughters. */
  resistant = false;
  x = 0;
  y = 0;
  z = 0;
  ax = 1;
  ay = 0;
  az = 0;
  halfLength = 0;
  radius = 0.45;
  /** Current growth rate relative to the species maximum (0..1). */
  activity = 1;
  bornTime = 0;
  parentId = -1;
  deathCause = DeathCause.None;
  deathTime = 0;

  // --- infection record (only meaningful while state === Infected) ---
  stage = InfectionStage.None;
  /** Seconds of infection progress (scaled by host activity). */
  infTime = 0;
  latent = 0;
  burst = 0;
  founderId = -1;
  founderGeneration = -1;
  founderLineage = false;
  /** Attach point of the founder phage: position along axis (-1..1) and angle around it. */
  attachU = 0;
  attachTheta = 0;
  /** Phages excluded after the founder (superinfection exclusion). */
  excluded = 0;

  isAlive(): boolean {
    return this.state !== BacteriaState.Dead;
  }
}
