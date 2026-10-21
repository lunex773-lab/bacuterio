/**
 * Separates simulation time from render time (design §3.3).
 * The simulation advances in fixed steps; rendering interpolates with `alpha`.
 * A per-frame CPU budget prevents fast playback from freezing the device.
 */
export class SimulationClock {
  paused = true;
  /** Simulated seconds per real second. */
  speed = 1;
  /** Max milliseconds of simulation work per frame. */
  budgetMs = 14;
  /** Fraction of the next step already elapsed, for render interpolation. */
  alpha = 0;
  /** True when the last frame could not keep up with the requested speed. */
  saturated = false;
  private accumulator = 0;

  /**
   * @param realDt  real seconds since the previous frame
   * @param stepDt  fixed simulation step (s)
   * @param advance callback that performs one simulation step
   * @param now     high resolution clock in ms (injected for testability)
   * @returns number of steps performed
   */
  tick(realDt: number, stepDt: number, advance: () => void, now: () => number = () => performance.now()): number {
    if (this.paused) {
      this.saturated = false;
      return 0;
    }
    // clamp long frames (tab switch, background resume) so the state never jumps
    const dt = Math.min(Math.max(realDt, 0), 0.1);
    this.accumulator += dt * this.speed;
    const start = now();
    let steps = 0;
    this.saturated = false;
    while (this.accumulator >= stepDt) {
      advance();
      this.accumulator -= stepDt;
      steps++;
      if (now() - start > this.budgetMs) {
        // drop the backlog instead of spiralling: playback runs slower than requested
        this.saturated = this.accumulator >= stepDt;
        if (this.saturated) this.accumulator = Math.min(this.accumulator, stepDt);
        break;
      }
    }
    this.alpha = Math.min(1, this.accumulator / stepDt);
    return steps;
  }

  /** Executes exactly one step regardless of speed (step button). */
  stepOnce(advance: () => void): void {
    advance();
    this.accumulator = 0;
    this.alpha = 0;
  }
}
