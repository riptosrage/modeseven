import type { Layout, Rect } from './geometry';

/** A growable bitmap of taken cells. Rows grow on demand; columns are fixed. */
export class Occupancy {
  private rows: Uint8Array[] = [];
  constructor(readonly cols: number) {}

  static from(layout: Layout, cols: number, ignore?: (id: string) => boolean) {
    const o = new Occupancy(cols);
    for (const id in layout) if (!ignore?.(id)) o.fill(layout[id]);
    return o;
  }

  private row(y: number) {
    while (this.rows.length <= y) this.rows.push(new Uint8Array(this.cols));
    return this.rows[y];
  }

  fill(r: Rect) {
    for (let y = r.y; y < r.y + r.h; y++) {
      const row = this.row(y);
      for (let x = Math.max(0, r.x); x < Math.min(this.cols, r.x + r.w); x++) row[x] = 1;
    }
  }

  isFree(r: Rect) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > this.cols) return false;
    for (let y = r.y; y < r.y + r.h; y++) {
      const row = this.rows[y];
      if (!row) return true; // rows past the end are empty
      for (let x = r.x; x < r.x + r.w; x++) if (row[x]) return false;
    }
    return true;
  }

  get height() {
    return this.rows.length;
  }
}
