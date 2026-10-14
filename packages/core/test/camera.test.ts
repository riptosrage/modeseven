import { describe, expect, it } from 'vitest';
import { screenToWorld, worldToScreen, zoomAround } from '../src/render/camera';
import { Spring } from '../src/loop/spring';

const vp = { w: 1200, h: 800 };

describe('camera', () => {
  it.each([0, 25, 50])('screen ↔ world round-trips at tilt %i°', (tilt) => {
    const c = { x: 500, y: 300, zoom: 0.8, tilt };
    for (const [sx, sy] of [
      [600, 400],
      [100, 700],
      [1100, 500],
      [300, 450],
    ]) {
      const w = screenToWorld(sx, sy, c, vp);
      const s = worldToScreen(w.x, w.y, c, vp);
      expect(s.x).toBeCloseTo(sx, 4);
      expect(s.y).toBeCloseTo(sy, 4);
    }
  });

  it('centre of the screen is the camera point', () => {
    expect(screenToWorld(600, 400, { x: 10, y: 20, zoom: 2, tilt: 40 }, vp)).toEqual({ x: 10, y: 20 });
  });

  it('zoomAround keeps the point under the cursor fixed', () => {
    const c = { x: 600, y: 400, zoom: 1, tilt: 30 };
    const s = { x: 900, y: 600 };
    const before = screenToWorld(s.x, s.y, c, vp);
    const after = screenToWorld(s.x, s.y, zoomAround(c, vp, s, 0.5), vp);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('spring', () => {
  it('settles on target without overshoot when critically damped', () => {
    const s = new Spring(0, { response: 0.25, damping: 1 });
    s.target = 100;
    let max = 0;
    for (let i = 0; i < 120 && s.step(1 / 60); i++) max = Math.max(max, s.value);
    expect(s.value).toBe(100);
    expect(max).toBeLessThanOrEqual(100.01);
  });

  it('can be retargeted mid-flight keeping velocity', () => {
    const s = new Spring(0, { response: 0.3, damping: 1 });
    s.target = 100;
    for (let i = 0; i < 6; i++) s.step(1 / 60);
    const v = s.velocity;
    s.target = 0;
    expect(s.velocity).toBe(v);
    s.step(1 / 60);
    expect(s.value).toBeGreaterThan(0);
  });
});
