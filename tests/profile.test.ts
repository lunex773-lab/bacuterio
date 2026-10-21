import { it } from 'vitest';
import { SimulationWorld } from '../src/core/SimulationWorld';
import { defaultConfig } from '../src/core/SimulationConfig';

it.skipIf(!process.env.PROFILE)('profile systems', () => {
  const w = new SimulationWorld(defaultConfig());
  const host = w.bacteria.find((b) => w.isHostSpecies(b.species))!;
  w.introducePhage(host.x + 1.5, host.y + 1, host.z);
  w.run(85 * 60 * 4);
  const t: Record<string, number> = {};
  const wrap = (obj: any, name: string, label: string) => {
    const f = obj[name].bind(obj);
    obj[name] = (...a: any[]) => { const s = performance.now(); const r = f(...a); t[label] = (t[label] ?? 0) + performance.now() - s; return r; };
  };
  wrap(w.bacteriaSystem, 'update', 'bact.update');
  wrap(w.bacteriaSystem, 'mechanics', 'bact.mech');
  wrap(w.bacteriaSystem, 'rebuildIndex', 'bact.index');
  wrap(w.phageSystem, 'update', 'phage');
  wrap(w.infection, 'update', 'infection');
  wrap(w.population, 'update', 'pop');
  wrap(w.population, 'rebalance', 'rebalance');
  wrap(w.env, 'update', 'env');
  const s0 = performance.now();
  w.run(1200);
  const total = performance.now() - s0;
  console.log('PROFILE phages', w.phages.length, 'cells', w.bacteria.length, 'per-step ms', (total / 1200).toFixed(3));
  for (const k in t) console.log('PROFILE', k, (t[k] / 1200).toFixed(3));
});
