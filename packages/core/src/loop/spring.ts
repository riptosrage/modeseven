/**
 * Springs tuned the way Apple describes them (WWDC18 "Designing Fluid
 * Interfaces"): `response` is roughly the time to settle in seconds,
 * `damping` 1 means no overshoot, lower means bouncier. No durations:
 * a spring can be retargeted mid-flight and keeps its velocity.
 */
export interface SpringConfig {
  response: number;
  damping: number;
}

export const SPRINGS = {
  /** Controls, toggles, small UI. */
  snap: { response: 0.18, damping: 1 },
  /** Neighbours making room. */
  glide: { response: 0.26, damping: 1 },
  /** A released module landing, carrying its throw. */
  drop: { response: 0.3, damping: 0.86 },
  /** Camera moves. */
  camera: { response: 0.35, damping: 1 },
} satisfies Record<string, SpringConfig>;

export class Spring {
  value: number;
  target: number;
  velocity = 0;
  constructor(
    value: number,
    public config: SpringConfig = SPRINGS.glide,
  ) {
    this.value = value;
    this.target = value;
  }

  /** Jump with no animation. */
  set(v: number) {
    this.value = this.target = v;
    this.velocity = 0;
  }

  get settled() {
    return Math.abs(this.value - this.target) < 0.05 && Math.abs(this.velocity) < 0.05;
  }

  /** Advance by dt seconds. Returns true while still moving. */
  step(dt: number): boolean {
    if (this.settled) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    const k = (2 * Math.PI / this.config.response) ** 2;
    const c = (4 * Math.PI * this.config.damping) / this.config.response;
    // Semi-implicit Euler with small substeps: stable at any frame rate.
    let t = Math.min(dt, 0.064);
    while (t > 0) {
      const h = Math.min(t, 1 / 240);
      const a = -k * (this.value - this.target) - c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
      t -= h;
    }
    return true;
  }
}

/** Where a throw would come to rest, using a scroll-like deceleration (UIScrollView "normal" ≈ 0.998 per ms). */
export const project = (velocityPxPerSec: number, decel = 0.998) => ((velocityPxPerSec / 1000) * decel) / (1 - decel);
