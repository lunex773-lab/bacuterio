import { describe, expect, it } from 'vitest';
import { SimEventType } from '../src/core/EventQueue';
import { defaultConfig, SimulationConfig } from '../src/core/SimulationConfig';
import { SimulationClock } from '../src/core/SimulationClock';
import { SimulationWorld } from '../src/core/SimulationWorld';
import { deserialize, serialize } from '../src/save/SaveSystem';
import { BacteriaState, DeathCause, InfectionStage } from '../src/simulation/bacteria/Bacterium';
import { PhageState } from '../src/simulation/phage/PhageAgent';

const small = (o: Partial<SimulationConfig> = {}): SimulationConfig =>
  defaultConfig({ initialBacteria: 180, colonies: 6, maxBacteria: 900, detailBudget: 600, ...o });

const minutes = (w: SimulationWorld, m: number): void => w.run(Math.round((m * 60) / w.config.dt));

function introduceNearHost(w: SimulationWorld): number {
  const host = w.bacteria.find((b) => w.isHostSpecies(b.species))!;
  return w.introducePhage(host.x + 1.2, host.y + 0.8, host.z);
}

describe('initial state', () => {
  it('starts with no phage, then exactly one after introduction', () => {
    const w = new SimulationWorld(small());
    expect(w.freePhageTotal()).toBe(0);
    const id = introduceNearHost(w);
    expect(w.freePhageTotal()).toBe(1);
    expect(w.phages[0].id).toBe(id);
    expect(w.phages[0].generation).toBe(0);
    expect(w.trackedInfo().state).toBe(PhageState.Free);
    // a second introduction is ignored
    w.introducePhage(0, 5, 0);
    expect(w.freePhageTotal()).toBe(1);
  });
});

describe('host compatibility', () => {
  it('never infects a non-host species', () => {
    const w = new SimulationWorld(small({ incompatibleFraction: 1 }));
    expect(w.bacteria.every((b) => !w.isHostSpecies(b.species))).toBe(true);
    const c = w.bacteria[0];
    w.introducePhage(c.x + 0.8, c.y, c.z);
    minutes(w, 40);
    expect(w.counters.infections).toBe(0);
    expect(w.bacteria.some((b) => b.state === BacteriaState.Infected)).toBe(false);
  });

  it('receptor-deficient (resistant) cells cannot be adsorbed', () => {
    const w = new SimulationWorld(small());
    const host = w.bacteria.find((b) => w.isHostSpecies(b.species))!;
    expect(w.canAdsorb(host)).toBe(true);
    host.resistant = true;
    host.state = BacteriaState.Resistant;
    expect(w.canAdsorb(host)).toBe(false);
  });
});

describe('infection cycle', () => {
  it('follows Adsorbing → Injecting → Early → Replication → Assembly → lysis', () => {
    const w = new SimulationWorld(small());
    introduceNearHost(w);
    let cellId = -1;
    for (let i = 0; i < 4 * 60 * 30 && cellId < 0; i++) {
      w.advance();
      const t = w.trackedInfo();
      if (t.hostId >= 0) cellId = t.hostId;
    }
    expect(cellId).toBeGreaterThan(0);
    const seen: InfectionStage[] = [];
    let burst = 0;
    for (let i = 0; i < 4 * 60 * 60; i++) {
      const c = w.findCell(cellId)!;
      if (c.state === BacteriaState.Dead) {
        expect(c.deathCause).toBe(DeathCause.Lysis);
        break;
      }
      if (seen[seen.length - 1] !== c.stage) seen.push(c.stage);
      burst = c.burst;
      w.advance();
    }
    expect(seen).toEqual([
      InfectionStage.Adsorbing,
      InfectionStage.Injecting,
      InfectionStage.Early,
      InfectionStage.Replication,
      InfectionStage.Assembly,
    ]);
    expect(burst).toBeGreaterThan(0);
    // tracking moves on to a first-generation progeny
    const t = w.trackedInfo();
    expect(w.lineage.length).toBeGreaterThanOrEqual(2);
    expect(w.lineage[1].generation).toBe(1);
    expect(w.lineage[0].burst).toBe(burst);
    expect([PhageState.Free, PhageState.Adsorbed, PhageState.Infected]).toContain(t.state);
  });
});

describe('bookkeeping', () => {
  it('conserves free phage counts across individual and population modes', () => {
    const w = new SimulationWorld(small({ detailBudget: 300 }));
    introduceNearHost(w);
    for (let m = 0; m < 120; m += 10) {
      minutes(w, 10);
      const c = w.counters;
      expect(w.freePhageTotal()).toBe(c.introduced + c.released - c.adsorbed - c.decayed);
      expect(w.phages.length).toBeLessThanOrEqual(w.config.detailBudget + 250);
    }
    expect(w.counters.released).toBeGreaterThan(0);
    expect(w.population.total).toBeGreaterThan(0); // population mode was exercised
  });

  it('rebalancing between modes keeps totals', () => {
    const w = new SimulationWorld(small({ detailBudget: 200 }));
    introduceNearHost(w);
    minutes(w, 90);
    const before = w.freePhageTotal();
    w.population.rebalance();
    expect(w.freePhageTotal()).toBe(before);
  });

  it('lysis events and dead-cell tallies agree', () => {
    const w = new SimulationWorld(small());
    introduceNearHost(w);
    let lysisEvents = 0;
    let released = 0;
    for (let m = 0; m < 90; m++) {
      minutes(w, 1);
      for (const e of w.events.drain()) {
        if (e.type === SimEventType.Lysis) {
          lysisEvents++;
          released += e.value;
        }
      }
    }
    expect(lysisEvents).toBe(w.counters.lysedCells);
    expect(released).toBe(w.counters.released);
    const s = w.snapshot();
    const alive = w.bacteria.filter((b) => b.state !== BacteriaState.Dead).length;
    expect(s.susceptible + s.infected + s.resistant + s.inactive + s.nonHost).toBe(alive);
  });
});

describe('time control', () => {
  it('does not advance while paused', () => {
    const w = new SimulationWorld(small());
    const clock = new SimulationClock();
    clock.paused = true;
    const steps = clock.tick(0.5, w.config.dt, () => w.advance());
    expect(steps).toBe(0);
    expect(w.time).toBe(0);
  });

  it('clamps long frames (background resume) and respects the work budget', () => {
    const w = new SimulationWorld(small());
    const clock = new SimulationClock();
    clock.paused = false;
    clock.speed = 1000;
    let fake = 0;
    const steps = clock.tick(30, w.config.dt, () => { w.advance(); fake += 5; }, () => fake);
    expect(steps).toBeLessThanOrEqual(4); // 14 ms budget at 5 ms/step
    expect(clock.saturated).toBe(true);
    clock.speed = 1;
    const s2 = clock.tick(30, w.config.dt, () => w.advance(), () => 0);
    expect(s2).toBeLessThanOrEqual(1); // 30 s gap clamped to 0.1 s
  });
});

describe('save / load and reproducibility', () => {
  it('round-trips the full state and continues identically', () => {
    const a = new SimulationWorld(small());
    introduceNearHost(a);
    minutes(a, 50);
    const data = JSON.parse(JSON.stringify(serialize(a)));
    const b = deserialize(data);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.snapshot()).toEqual(a.snapshot());
    minutes(a, 20);
    minutes(b, 20);
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('same seed and commands reproduce the same computation path', () => {
    const a = new SimulationWorld(small({ seed: 7 }));
    const b = new SimulationWorld(small({ seed: 7 }));
    introduceNearHost(a);
    introduceNearHost(b);
    minutes(a, 45);
    minutes(b, 45);
    expect(a.stateHash()).toBe(b.stateHash());
    const r = SimulationWorld.replay(small({ seed: 7 }), a.commands, a.step);
    expect(r.stateHash()).toBe(a.stateHash());
  });

  it('different seeds diverge', () => {
    const a = new SimulationWorld(small({ seed: 1 }));
    const b = new SimulationWorld(small({ seed: 2 }));
    expect(a.stateHash()).not.toBe(b.stateHash());
  });
});

describe('statistical validity', () => {
  it('mean burst size and latent period match parameters across seeds', () => {
    const bursts: number[] = [];
    const latents: number[] = [];
    for (let seed = 1; seed <= 4; seed++) {
      const w = new SimulationWorld(small({ seed }));
      introduceNearHost(w);
      for (let i = 0; i < 4 * 60 * 60; i++) {
        w.advance();
        for (const b of w.bacteria) {
          if (b.state === BacteriaState.Infected && b.stage === InfectionStage.Adsorbing && b.infTime === w.config.dt) {
            // burst scales with host activity at infection; normalise it back
            bursts.push(b.burst / (0.35 + 0.65 * b.activity));
            latents.push(b.latent);
          }
        }
      }
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(bursts.length).toBeGreaterThan(50);
    const p = new SimulationWorld(small()).phageParams;
    expect(Math.abs(mean(latents) - p.latentMean)).toBeLessThan(60);
    expect(Math.abs(mean(bursts) - p.burstMean)).toBeLessThan(p.burstMean * 0.1);
  });
});
