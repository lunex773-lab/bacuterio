/**
 * Deterministic, serializable PRNG (xoshiro128**).
 * Simulation code must never use Math.random(); everything goes through this
 * so that the same seed reproduces the same computation path.
 * Unity port: System.UInt32 state[4] with identical bit operations.
 */
export class Random {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private spare = 0;
  private hasSpare = false;

  constructor(seed: number) {
    this.setSeed(seed);
  }

  setSeed(seed: number): void {
    // splitmix32 to spread the seed over the 128-bit state
    let x = seed >>> 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
    this.hasSpare = false;
    this.spare = 0;
  }

  /** Uniform uint32. */
  nextUint(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    this.s0 >>>= 0;
    this.s1 >>>= 0;
    this.s2 >>>= 0;
    this.s3 >>>= 0;
    return result;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal via polar Box–Muller; the spare value is part of the saved state. */
  normal(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    this.hasSpare = true;
    return u * m;
  }

  gaussian(mean: number, sd: number): number {
    return mean + sd * this.normal();
  }

  /** Poisson sample (Knuth for small lambda, normal approximation for large). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      const l = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.next();
      } while (p > l);
      return k - 1;
    }
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
  }

  /** Binomial sample. Exact for small n, approximations otherwise. */
  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n < 40) {
      let k = 0;
      for (let i = 0; i < n; i++) if (this.next() < p) k++;
      return k;
    }
    const mean = n * p;
    if (mean < 15) return Math.min(n, this.poisson(mean));
    const sd = Math.sqrt(mean * (1 - p));
    return Math.min(n, Math.max(0, Math.round(mean + sd * this.normal())));
  }

  /** Random unit vector, written into out[0..2]. */
  unitVector(out: number[]): number[] {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    out[0] = r * Math.cos(a);
    out[1] = r * Math.sin(a);
    out[2] = z;
    return out;
  }

  getState(): number[] {
    return [this.s0, this.s1, this.s2, this.s3, this.hasSpare ? 1 : 0, this.spare];
  }

  setState(state: number[]): void {
    this.s0 = state[0] >>> 0;
    this.s1 = state[1] >>> 0;
    this.s2 = state[2] >>> 0;
    this.s3 = state[3] >>> 0;
    this.hasSpare = state[4] === 1;
    this.spare = state[5] ?? 0;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
