import { it } from 'vitest';
import { SimulationWorld } from '../src/core/SimulationWorld';
import { defaultConfig } from '../src/core/SimulationConfig';

it.skipIf(!process.env.HEADLESS)('headless trace', () => {
  const w = new SimulationWorld(defaultConfig({ phageId: process.env.PHAGE ?? 'T4' }));
  const host = w.bacteria.find((b) => w.isHostSpecies(b.species))!;
  w.introducePhage(host.x + 1.5, host.y + 1, host.z);
  const t0 = performance.now();
  for (let m = 0; m <= Number(process.env.MIN ?? 180); m += 5) {
    const s = w.snapshot();
    const tr = w.trackedInfo();
    console.log(`t=${m}min cells S${s.susceptible} I${s.infected} R${s.resistant} D${s.inactive} N${s.nonHost} | phage ind${s.freeIndividual} pop${s.freePopulation} intra${s.intracellular} | lysed ${s.lysedTotal} nut ${w.env.meanNutrient().toFixed(2)} | tracked st${tr.state} gen${tr.generation} | ${(performance.now()-t0).toFixed(0)}ms`);
    w.run(5 * 60 / w.config.dt);
  }
});
