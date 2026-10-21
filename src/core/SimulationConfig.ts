import phageData from '../data/phages.json';
import speciesData from '../data/species.json';
import environmentData from '../data/environment.json';

/** Localised text. Unity port: a small serializable struct. */
export interface LocalizedText {
  ja: string;
  en: string;
}

/**
 * Every biological parameter carries its provenance so that the game can
 * show what is measured, what is approximated and what is an assumption.
 * (Design doc §3.5: evidenceLevel / modelType / parameterSource / uncertainty / modelVersion)
 */
export interface ParamMeta {
  value: number;
  unit: string;
  evidenceLevel: 'literature-range' | 'approximation' | 'assumption';
  modelType: 'measured' | 'approximate' | 'presentational';
  source: LocalizedText;
  uncertainty: LocalizedText;
}

export interface PhageSpec {
  id: string;
  name: LocalizedText;
  family: LocalizedText;
  morphology: 'myovirus' | 'podovirus';
  hostSpecies: string[];
  lifecycle: 'lytic';
  params: Record<PhageParamKey, ParamMeta>;
}

export type PhageParamKey =
  | 'adsorptionRate'
  | 'diffusion'
  | 'adsorbPhase'
  | 'injectPhase'
  | 'eclipse'
  | 'latentMean'
  | 'latentSd'
  | 'burstMean'
  | 'burstSd'
  | 'decayRate';

export type SpeciesParamKey =
  | 'radius'
  | 'birthHalfLength'
  | 'divisionHalfLength'
  | 'doublingTime'
  | 'resistanceMutation'
  | 'resistanceCost'
  | 'initialResistant'
  | 'deathRate';

export interface SpeciesSpec {
  id: string;
  name: LocalizedText;
  shape: 'rod' | 'coccus';
  params: Record<SpeciesParamKey, ParamMeta>;
}

export type EnvironmentParamKey =
  | 'sizeX'
  | 'sizeY'
  | 'sizeZ'
  | 'voxelSize'
  | 'nutrientHalfSat'
  | 'nutrientUptake'
  | 'nutrientInflow'
  | 'nutrientDiffusion'
  | 'dormancyThreshold'
  | 'temperature'
  | 'pH';

export interface EnvironmentSpec {
  name: LocalizedText;
  params: Record<EnvironmentParamKey, ParamMeta>;
}

export const MODEL_VERSION = phageData.modelVersion;
export const PHAGE_SPECS = phageData.phages as PhageSpec[];
export const SPECIES_SPECS = speciesData.species as SpeciesSpec[];
export const ENVIRONMENT_SPEC = environmentData as EnvironmentSpec;

/**
 * Run-level settings. Everything that influences the computation lives here
 * and is stored in save files, so a run can be reproduced from (config, seed, commands).
 */
export interface SimulationConfig {
  seed: number;
  phageId: string;
  /** Fixed simulation time step in seconds. */
  dt: number;
  /** Steps between cell-mechanics relaxation passes. */
  mechanicsInterval: number;
  /** Steps between population-model (voxel) updates. */
  populationInterval: number;
  /** Steps between individual <-> population rebalancing. */
  rebalanceInterval: number;
  /** Maximum individually simulated free phages (detail mode budget). */
  detailBudget: number;
  maxBacteria: number;
  initialBacteria: number;
  /** Fraction of initial cells that belong to the non-host species. */
  incompatibleFraction: number;
  colonies: number;
}

export function defaultConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    seed: 20261021,
    phageId: 'T4',
    dt: 0.25,
    mechanicsInterval: 8,
    populationInterval: 4,
    rebalanceInterval: 20,
    detailBudget: 2500,
    maxBacteria: 1800,
    initialBacteria: 420,
    incompatibleFraction: 0.22,
    colonies: 9,
    ...overrides,
  };
}

export function getPhageSpec(id: string): PhageSpec {
  const spec = PHAGE_SPECS.find((p) => p.id === id);
  if (!spec) throw new Error(`Unknown phage spec: ${id}`);
  return spec;
}

/** Plain numeric view of the parameters, resolved once per world. */
export interface ResolvedPhageParams {
  adsorptionRate: number;
  diffusion: number;
  adsorbPhase: number;
  injectPhase: number;
  eclipse: number;
  latentMean: number;
  latentSd: number;
  burstMean: number;
  burstSd: number;
  decayRate: number;
  hostSpecies: number[];
}

export interface ResolvedSpeciesParams {
  shape: number; // 0 rod, 1 coccus
  radius: number;
  birthHalfLength: number;
  divisionHalfLength: number;
  growthRateMax: number;
  resistanceMutation: number;
  resistanceCost: number;
  initialResistant: number;
  deathRate: number;
}

export interface ResolvedEnvironmentParams {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxelSize: number;
  nutrientHalfSat: number;
  nutrientUptake: number;
  nutrientInflow: number;
  nutrientDiffusion: number;
  dormancyThreshold: number;
}

export function resolvePhage(spec: PhageSpec): ResolvedPhageParams {
  const p = spec.params;
  return {
    adsorptionRate: p.adsorptionRate.value,
    diffusion: p.diffusion.value,
    adsorbPhase: p.adsorbPhase.value,
    injectPhase: p.injectPhase.value,
    eclipse: p.eclipse.value,
    latentMean: p.latentMean.value,
    latentSd: p.latentSd.value,
    burstMean: p.burstMean.value,
    burstSd: p.burstSd.value,
    decayRate: p.decayRate.value,
    hostSpecies: spec.hostSpecies.map((id) => SPECIES_SPECS.findIndex((s) => s.id === id)),
  };
}

export function resolveSpecies(spec: SpeciesSpec): ResolvedSpeciesParams {
  const p = spec.params;
  return {
    shape: spec.shape === 'rod' ? 0 : 1,
    radius: p.radius.value,
    birthHalfLength: p.birthHalfLength.value,
    divisionHalfLength: p.divisionHalfLength.value,
    growthRateMax: Math.LN2 / p.doublingTime.value,
    resistanceMutation: p.resistanceMutation.value,
    resistanceCost: p.resistanceCost.value,
    initialResistant: p.initialResistant.value,
    deathRate: p.deathRate.value,
  };
}

export function resolveEnvironment(spec: EnvironmentSpec): ResolvedEnvironmentParams {
  const p = spec.params;
  return {
    sizeX: p.sizeX.value,
    sizeY: p.sizeY.value,
    sizeZ: p.sizeZ.value,
    voxelSize: p.voxelSize.value,
    nutrientHalfSat: p.nutrientHalfSat.value,
    nutrientUptake: p.nutrientUptake.value,
    nutrientInflow: p.nutrientInflow.value,
    nutrientDiffusion: p.nutrientDiffusion.value,
    dormancyThreshold: p.dormancyThreshold.value,
  };
}
