import { ResolvedEnvironmentParams } from '../../core/SimulationConfig';

/**
 * Voxelised local environment (design §3.4). The observed compartment is
 * x ∈ [-sizeX/2, sizeX/2], y ∈ [0, sizeY] (y = 0 is the mucus surface), z ∈ [-sizeZ/2, sizeZ/2].
 * Nutrient is a relative concentration (1 = rich lumen fluid).
 */
export class EnvironmentSystem {
  readonly params: ResolvedEnvironmentParams;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly voxelVolume: number;
  readonly minX: number;
  readonly minZ: number;
  nutrient: Float64Array;
  private scratch: Float64Array;

  constructor(params: ResolvedEnvironmentParams) {
    this.params = params;
    const v = params.voxelSize;
    this.nx = Math.ceil(params.sizeX / v);
    this.ny = Math.ceil(params.sizeY / v);
    this.nz = Math.ceil(params.sizeZ / v);
    this.voxelVolume = v * v * v;
    this.minX = -params.sizeX / 2;
    this.minZ = -params.sizeZ / 2;
    this.nutrient = new Float64Array(this.voxelCount).fill(1);
    this.scratch = new Float64Array(this.voxelCount);
  }

  get voxelCount(): number {
    return this.nx * this.ny * this.nz;
  }

  voxelIndex(x: number, y: number, z: number): number {
    const v = this.params.voxelSize;
    let ix = Math.floor((x - this.minX) / v);
    let iy = Math.floor(y / v);
    let iz = Math.floor((z - this.minZ) / v);
    ix = ix < 0 ? 0 : ix >= this.nx ? this.nx - 1 : ix;
    iy = iy < 0 ? 0 : iy >= this.ny ? this.ny - 1 : iy;
    iz = iz < 0 ? 0 : iz >= this.nz ? this.nz - 1 : iz;
    return (iz * this.ny + iy) * this.nx + ix;
  }

  /** Writes the voxel's minimum corner into out[0..2]. */
  voxelOrigin(index: number, out: number[]): number[] {
    const v = this.params.voxelSize;
    const ix = index % this.nx;
    const iy = Math.floor(index / this.nx) % this.ny;
    const iz = Math.floor(index / (this.nx * this.ny));
    out[0] = this.minX + ix * v;
    out[1] = iy * v;
    out[2] = this.minZ + iz * v;
    return out;
  }

  /** Neighbour voxel index in direction d (0..5: -x,+x,-y,+y,-z,+z) or -1 at the boundary. */
  neighbor(index: number, d: number): number {
    const ix = index % this.nx;
    const iy = Math.floor(index / this.nx) % this.ny;
    const iz = Math.floor(index / (this.nx * this.ny));
    switch (d) {
      case 0: return ix > 0 ? index - 1 : -1;
      case 1: return ix < this.nx - 1 ? index + 1 : -1;
      case 2: return iy > 0 ? index - this.nx : -1;
      case 3: return iy < this.ny - 1 ? index + this.nx : -1;
      case 4: return iz > 0 ? index - this.nx * this.ny : -1;
      default: return iz < this.nz - 1 ? index + this.nx * this.ny : -1;
    }
  }

  /** Monod factor μ/μmax at a voxel. */
  growthFactor(index: number): number {
    const n = this.nutrient[index];
    return n / (this.params.nutrientHalfSat + n);
  }

  consume(index: number, amount: number): void {
    const n = this.nutrient[index] - amount;
    this.nutrient[index] = n > 0 ? n : 0;
  }

  /** Diffusion between voxels and supply from the lumen side (top layer). */
  update(dt: number): void {
    const k = this.params.nutrientDiffusion * dt;
    const n = this.nutrient;
    const s = this.scratch;
    for (let i = 0; i < n.length; i++) {
      let flux = 0;
      for (let d = 0; d < 6; d++) {
        const j = this.neighbor(i, d);
        if (j >= 0) flux += n[j] - n[i];
      }
      s[i] = n[i] + k * flux;
    }
    const inflow = this.params.nutrientInflow * dt;
    const top = this.ny - 1;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const i = (iz * this.ny + top) * this.nx + ix;
        s[i] += inflow * (1 - s[i]);
      }
    }
    for (let i = 0; i < n.length; i++) n[i] = s[i] < 0 ? 0 : s[i] > 1 ? 1 : s[i];
  }

  meanNutrient(): number {
    let sum = 0;
    for (let i = 0; i < this.nutrient.length; i++) sum += this.nutrient[i];
    return sum / this.nutrient.length;
  }
}
