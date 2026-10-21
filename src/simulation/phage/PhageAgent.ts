/**
 * Observable phage lifecycle states (design §3.1).
 * Free particles are PhageAgents; once adsorbed, the phage's identity moves
 * into the host cell's infection record (Bacterium.founderId).
 */
export enum PhageState {
  Free = 0,
  Adsorbed = 1,
  Infected = 2,
  Lytic = 3,
  Lysogenic = 4, // reserved — not used in the MVP (lytic model only)
  Lost = 5,
}

/** An individually simulated free phage (detail mode). */
export class PhageAgent {
  id = 0;
  x = 0;
  y = 0;
  z = 0;
  /** Position at the previous step, for render interpolation only. */
  px = 0;
  py = 0;
  pz = 0;
  parentId = -1;
  /** Generation from the introduced phage (0). -1 = unknown (spawned from population). */
  generation = -1;
  /** Protected from demotion: member of the tracked lineage. */
  lineage = false;
  bornTime = 0;
}
