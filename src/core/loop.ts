export interface LoopHooks {
  /** Fixed-step simulation tick; dt is constant. */
  update(dt: number): void;
  /** Render with interpolation factor alpha in [0,1) and real frame delta. */
  render(alpha: number, frameDt: number): void;
}

/** Fixed-timestep loop with render interpolation, optional frame cap. */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private lastRender = 0;
  timeScale = 1;
  /** 0 = uncapped */
  fpsCap = 0;
  fps = 0;
  private fpsFrames = 0;
  private fpsT = 0;

  constructor(private hooks: LoopHooks, readonly step = 1 / 60, private maxSteps = 5) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const frame = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      if (this.fpsCap > 0 && now - this.lastRender < 1000 / this.fpsCap - 1.5) return;
      this.lastRender = now;
      const dt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= this.step && steps < this.maxSteps) {
        this.hooks.update(this.step);
        this.acc -= this.step;
        steps++;
      }
      if (steps === this.maxSteps) this.acc = 0; // spiral-of-death guard
      this.hooks.render(this.acc / this.step, dt);
      this.fpsFrames++;
      this.fpsT += dt;
      if (this.fpsT >= 0.5) { this.fps = this.fpsFrames / this.fpsT; this.fpsFrames = 0; this.fpsT = 0; }
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.raf); }
}
