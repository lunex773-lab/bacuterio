/**
 * Uniform grid built with a counting sort each step.
 * Allocation-free after construction (Unity port: NativeArray-friendly).
 */
export class SpatialHash {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly minZ: number;
  private cellStart: Int32Array;
  private cellFill: Int32Array;
  private items: Int32Array;
  private itemCell: Int32Array;

  constructor(minX: number, minY: number, minZ: number, sizeX: number, sizeY: number, sizeZ: number, cellSize: number) {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.cellSize = cellSize;
    this.nx = Math.max(1, Math.ceil(sizeX / cellSize));
    this.ny = Math.max(1, Math.ceil(sizeY / cellSize));
    this.nz = Math.max(1, Math.ceil(sizeZ / cellSize));
    const n = this.nx * this.ny * this.nz;
    this.cellStart = new Int32Array(n + 1);
    this.cellFill = new Int32Array(n);
    this.items = new Int32Array(1024);
    this.itemCell = new Int32Array(1024);
  }

  cellIndex(x: number, y: number, z: number): number {
    const ix = clampInt(Math.floor((x - this.minX) / this.cellSize), this.nx);
    const iy = clampInt(Math.floor((y - this.minY) / this.cellSize), this.ny);
    const iz = clampInt(Math.floor((z - this.minZ) / this.cellSize), this.nz);
    return (iz * this.ny + iy) * this.nx + ix;
  }

  build(count: number, xs: ArrayLike<number>, ys: ArrayLike<number>, zs: ArrayLike<number>): void {
    if (this.items.length < count) {
      this.items = new Int32Array(count * 2);
      this.itemCell = new Int32Array(count * 2);
    }
    const n = this.cellFill.length;
    this.cellStart.fill(0);
    for (let i = 0; i < count; i++) {
      const c = this.cellIndex(xs[i], ys[i], zs[i]);
      this.itemCell[i] = c;
      this.cellStart[c + 1]++;
    }
    for (let c = 0; c < n; c++) this.cellStart[c + 1] += this.cellStart[c];
    this.cellFill.fill(0);
    for (let i = 0; i < count; i++) {
      const c = this.itemCell[i];
      this.items[this.cellStart[c] + this.cellFill[c]++] = i;
    }
  }

  /**
   * Writes the indices of all items in grid cells overlapping the query cube into out
   * and returns how many were written (allocation-free, no callbacks).
   */
  queryInto(x: number, y: number, z: number, radius: number, out: Int32Array): number {
    const cs = this.cellSize;
    const x0 = clampInt(Math.floor((x - radius - this.minX) / cs), this.nx);
    const x1 = clampInt(Math.floor((x + radius - this.minX) / cs), this.nx);
    const y0 = clampInt(Math.floor((y - radius - this.minY) / cs), this.ny);
    const y1 = clampInt(Math.floor((y + radius - this.minY) / cs), this.ny);
    const z0 = clampInt(Math.floor((z - radius - this.minZ) / cs), this.nz);
    const z1 = clampInt(Math.floor((z + radius - this.minZ) / cs), this.nz);
    let n = 0;
    const cap = out.length;
    for (let iz = z0; iz <= z1; iz++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const c = (iz * this.ny + iy) * this.nx + ix;
          const end = this.cellStart[c + 1];
          for (let k = this.cellStart[c]; k < end && n < cap; k++) out[n++] = this.items[k];
        }
      }
    }
    return n;
  }
}

function clampInt(v: number, n: number): number {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}
