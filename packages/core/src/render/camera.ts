/**
 * The camera looks at the board. `x, y` is the world point shown at the
 * centre of the viewport, `zoom` scales, and `tilt` leans the board back
 * like SNES Mode 7, so far rows recede toward a horizon.
 *
 * World units are CSS px at zoom 1. All maths here is pure so it can be
 * unit tested and shared by rendering and hit testing.
 */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  /** Degrees, 0 = flat. */
  tilt: number;
}

export interface Viewport {
  w: number;
  h: number;
  /** Perspective distance in px. Smaller = more dramatic tilt. Default 1.1 × the longer side. */
  d?: number;
}

/** CSS perspective distance. Smaller = more dramatic. */
export const perspectiveFor = (vp: Viewport) => vp.d ?? Math.max(vp.w, vp.h) * 1.1;

/** CSS transform for the world element (transform-origin 0 0, placed at the viewport's top-left). */
export function worldTransform(c: CameraState, vp: Viewport): string {
  const d = perspectiveFor(vp);
  const t = c.tilt ? ` perspective(${d}px) rotateX(${c.tilt}deg)` : '';
  return `translate3d(${vp.w / 2}px, ${vp.h / 2}px, 0)${t} scale(${c.zoom}) translate3d(${-c.x}px, ${-c.y}px, 0)`;
}

/**
 * Screen point (relative to the viewport's top-left) → world point on the board.
 * With tilt this intersects the view ray with the tilted plane.
 */
export function screenToWorld(sx: number, sy: number, c: CameraState, vp: Viewport) {
  const dx = sx - vp.w / 2;
  const dy = sy - vp.h / 2;
  let u = dx;
  let v = dy;
  if (c.tilt) {
    const d = perspectiveFor(vp);
    const th = (c.tilt * Math.PI) / 180;
    const denom = d * Math.cos(th) + dy * Math.sin(th);
    // Above the horizon the ray never meets the board; pin it far away.
    v = denom > 1 ? (dy * d) / denom : -1e6;
    const k = d / (d - v * Math.sin(th));
    u = dx / k;
  }
  return { x: c.x + u / c.zoom, y: c.y + v / c.zoom };
}

/** World point → screen point. Inverse of screenToWorld. */
export function worldToScreen(wx: number, wy: number, c: CameraState, vp: Viewport) {
  const u = (wx - c.x) * c.zoom;
  const v = (wy - c.y) * c.zoom;
  if (!c.tilt) return { x: vp.w / 2 + u, y: vp.h / 2 + v };
  const d = perspectiveFor(vp);
  const th = (c.tilt * Math.PI) / 180;
  const z = v * Math.sin(th);
  const k = d / (d - z);
  return { x: vp.w / 2 + u * k, y: vp.h / 2 + v * Math.cos(th) * k };
}

/** New camera centre so that world point `w` stays under screen point `s` at a new zoom. */
export function zoomAround(c: CameraState, vp: Viewport, s: { x: number; y: number }, zoom: number): CameraState {
  const w = screenToWorld(s.x, s.y, c, vp);
  const flat = screenToWorld(s.x, s.y, { ...c, x: 0, y: 0, zoom }, vp);
  return { ...c, zoom, x: w.x - flat.x, y: w.y - flat.y };
}
