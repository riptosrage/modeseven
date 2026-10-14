/**
 * One frame loop for the whole engine, like a game's update loop.
 * Tasks return true to keep running. When nothing is running, the loop
 * stops completely: an idle board costs zero CPU.
 */
export type Task = (dt: number, now: number) => boolean | void;

export class Clock {
  private tasks = new Set<Task>();
  private raf = 0;
  private last = 0;
  /** Smoothed frame time in ms, for the debug overlay. */
  frameMs = 16.7;

  /** Run `task` every frame until it returns a falsy value. */
  run(task: Task) {
    this.tasks.add(task);
    this.wake();
    return () => void this.tasks.delete(task);
  }

  /** Run `task` every frame until the returned stop function is called. */
  every(task: (dt: number, now: number) => void) {
    const t: Task = (dt, now) => (task(dt, now), true);
    return this.run(t);
  }

  wake() {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  get running() {
    return this.raf !== 0;
  }

  private frame = (now: number) => {
    const dt = Math.min(0.064, Math.max(0, (now - this.last) / 1000));
    this.frameMs += (now - this.last - this.frameMs) * 0.1;
    this.last = now;
    for (const t of [...this.tasks]) if (!t(dt, now)) this.tasks.delete(t);
    this.raf = this.tasks.size ? requestAnimationFrame(this.frame) : 0;
  };
}
