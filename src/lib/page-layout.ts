/* Tiện ích bố cục grid dùng chung giữa PageDesigner và ConsumerPage. */

export interface LayoutComp {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Sắp xếp lại components sau khi chèn/thay đổi kích thước anchor:
 *  Nếu B chồng lên A, đẩy B sang phải (nếu vừa) hoặc xuống dưới.
 *  Lặp tối đa 30 vòng đến khi ổn định. */
export function applyInsertAndResolve<T extends LayoutComp>(anchorId: string, comps: T[]): T[] {
  const overlaps = (
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number,
  ) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  let result = comps.map((c) => ({ ...c }));
  for (let pass = 0; pass < 30; pass++) {
    const sorted = [...result].sort((a, b) => {
      if (a.id === anchorId) return -1;
      if (b.id === anchorId) return 1;
      return a.y !== b.y ? a.y - b.y : a.x - b.x;
    });
    let changed = false;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]!;
        if (b.id === anchorId) continue;
        if (!overlaps(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h)) continue;
        const newBX = a.x + a.w;
        sorted[j] = newBX + b.w <= 12 ? { ...b, x: newBX } : { ...b, x: b.x, y: a.y + a.h };
        changed = true;
      }
    }
    if (!changed) break;
    for (const s of sorted) {
      const idx = result.findIndex((r) => r.id === s.id);
      if (idx >= 0) result[idx] = { ...result[idx]!, x: s.x, y: s.y };
    }
  }
  return result;
}
