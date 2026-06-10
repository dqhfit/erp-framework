/* ==========================================================
   migration-delta-sync.test.ts — Unit test giao thức keyset CT.

   Lỗi gốc (P0): mọi row đổi trong CÙNG 1 transaction MSSQL mang CÙNG
   SYS_CHANGE_VERSION; phân trang TOP n + "version > watermark" làm MẤT
   phần nhóm version bị TOP cắt. Test mô phỏng nguồn CHANGETABLE (filter
   + order y hệt SQL trong readCtChanges) và chạy đúng quy tắc cursor /
   watermark của syncTableCt → chứng minh: không mất row, watermark chỉ
   advance khi nhóm version trọn vẹn, crash-resume không bỏ sót.
   ========================================================== */
import { describe, expect, it } from "vitest";
import { ctSafeWatermark } from "./migration-delta-sync";

interface CtRow {
  ver: number;
  pk: number;
}

/** Mô phỏng query keyset trong MssqlClient.readCtChanges:
 *  CHANGETABLE(CHANGES x, @anchor) → ver > anchor;
 *  WHERE ver > cursorVer OR (ver = cursorVer AND pk > cursorPk);
 *  ORDER BY ver, pk; TOP batchSize. */
function fakeReadCtChanges(
  source: CtRow[],
  opts: {
    anchorVersion: number;
    cursorVersion: number;
    cursorPk: number | null;
    batchSize: number;
  },
): { rows: CtRow[]; nextVersion: number; nextCursorPk: number | null; isEnd: boolean } {
  const filtered = source
    .filter((r) => r.ver > opts.anchorVersion)
    .filter(
      (r) =>
        r.ver > opts.cursorVersion ||
        (r.ver === opts.cursorVersion && opts.cursorPk !== null && r.pk > opts.cursorPk),
    )
    .sort((a, b) => a.ver - b.ver || a.pk - b.pk)
    .slice(0, opts.batchSize);
  const last = filtered[filtered.length - 1];
  return {
    rows: filtered,
    nextVersion: last ? last.ver : opts.cursorVersion,
    nextCursorPk: last ? last.pk : null,
    isEnd: filtered.length < opts.batchSize,
  };
}

/** Chạy đúng vòng lặp consume của syncTableCt (cursor + watermark).
 *  Trả các pk đã thấy + watermark persist cuối. */
function consumeAll(
  source: CtRow[],
  startWatermark: number,
  batchSize: number,
): { seen: number[]; persisted: number } {
  const anchorVersion = startWatermark;
  let persistedVersion = startWatermark;
  let cursorVersion = startWatermark;
  let cursorPk: number | null = null;
  const seen: number[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    const batch = fakeReadCtChanges(source, { anchorVersion, cursorVersion, cursorPk, batchSize });
    if (batch.rows.length === 0) {
      // Batch rỗng = nhóm tại cursor đã trọn → persist nốt (khớp syncTableCt).
      persistedVersion = Math.max(persistedVersion, cursorVersion);
      break;
    }
    seen.push(...batch.rows.map((r) => r.pk));
    persistedVersion = ctSafeWatermark(persistedVersion, batch.nextVersion, batch.isEnd);
    cursorVersion = batch.nextVersion;
    cursorPk = batch.nextCursorPk;
    if (batch.isEnd) break;
  }
  return { seen, persisted: persistedVersion };
}

describe("ctSafeWatermark", () => {
  it("isEnd → persist max version (nhóm cuối đã trọn)", () => {
    expect(ctSafeWatermark(10, 15, true)).toBe(15);
  });

  it("chưa isEnd → chỉ persist max - 1 (nhóm cuối có thể bị TOP cắt)", () => {
    expect(ctSafeWatermark(10, 15, false)).toBe(14);
  });

  it("không bao giờ lùi dưới watermark đã persist", () => {
    // Nhóm version khổng lồ: max = persisted + 1, chưa isEnd → max-1 = persisted.
    expect(ctSafeWatermark(14, 15, false)).toBe(14);
    expect(ctSafeWatermark(20, 15, false)).toBe(20);
  });
});

describe("giao thức keyset CT (mô phỏng CHANGETABLE)", () => {
  it("1 transaction đổi NHIỀU hơn batchSize row (cùng version) → không mất row nào", () => {
    // 1200 row cùng version 7 (1 transaction bulk-update) + vài version lẻ.
    const source: CtRow[] = [
      { ver: 6, pk: 9001 },
      ...Array.from({ length: 1200 }, (_, i) => ({ ver: 7, pk: i + 1 })),
      { ver: 8, pk: 9002 },
    ];
    const { seen, persisted } = consumeAll(source, 5, 500);
    expect(seen).toHaveLength(1202);
    expect(new Set(seen).size).toBe(1202);
    expect(persisted).toBe(8);
  });

  it("phân trang cũ (chỉ theo version) tái hiện đúng lỗi mất row — làm chứng", () => {
    // Cách cũ: vòng sau lọc "ver > maxVerBatchTrước" → mất phần nhóm bị cắt.
    const source: CtRow[] = Array.from({ length: 1200 }, (_, i) => ({ ver: 7, pk: i + 1 }));
    let lastVersion = 5;
    const seen: number[] = [];
    for (let guard = 0; guard < 100; guard++) {
      const rows = source
        .filter((r) => r.ver > lastVersion)
        .sort((a, b) => a.ver - b.ver || a.pk - b.pk)
        .slice(0, 500);
      if (rows.length === 0) break;
      seen.push(...rows.map((r) => r.pk));
      lastVersion = Math.max(...rows.map((r) => r.ver));
      if (rows.length < 500) break;
    }
    expect(seen.length).toBeLessThan(1200); // mất 700 row — lỗi đã vá
  });

  it("crash giữa run rồi resume từ watermark persist → không sót row vĩnh viễn", () => {
    const source: CtRow[] = [
      ...Array.from({ length: 800 }, (_, i) => ({ ver: 7, pk: i + 1 })),
      ...Array.from({ length: 300 }, (_, i) => ({ ver: 9, pk: i + 2000 })),
    ];
    const batchSize = 500;
    const everSeen = new Set<number>();
    let persisted = 5;
    // Mỗi "phiên" chạy 2 batch rồi crash (cursor in-memory mất, chỉ còn
    // watermark đã persist). Re-đọc được phép (upsert idempotent) — yêu cầu
    // là KHÔNG bỏ sót vĩnh viễn và hội tụ. (Lưu ý: nhóm version > batchSize
    // cần phiên sống đủ lâu để vượt qua nhóm — trong code thật 1 run xử lý
    // liên tiếp mọi batch nên điều kiện này luôn thoả trừ crash-loop.)
    for (let session = 0; session < 50; session++) {
      const anchorVersion = persisted;
      let cursorVersion = persisted;
      let cursorPk: number | null = null;
      let done = false;
      for (let b = 0; b < 2; b++) {
        const batch = fakeReadCtChanges(source, {
          anchorVersion,
          cursorVersion,
          cursorPk,
          batchSize,
        });
        if (batch.rows.length === 0) {
          persisted = Math.max(persisted, cursorVersion);
          done = true;
          break;
        }
        for (const r of batch.rows) everSeen.add(r.pk);
        persisted = ctSafeWatermark(persisted, batch.nextVersion, batch.isEnd);
        cursorVersion = batch.nextVersion;
        cursorPk = batch.nextCursorPk;
        if (batch.isEnd) {
          done = true;
          break;
        }
      }
      if (done && everSeen.size === 1100) break;
      // crash: cursor mất, chỉ persisted còn lại.
    }
    expect(everSeen.size).toBe(1100);
    expect(persisted).toBe(9);
  });

  it("nhóm version đúng bằng batchSize → vẫn kết thúc và persist đủ", () => {
    const source: CtRow[] = Array.from({ length: 500 }, (_, i) => ({ ver: 7, pk: i + 1 }));
    const { seen, persisted } = consumeAll(source, 5, 500);
    expect(seen).toHaveLength(500);
    expect(persisted).toBe(7);
  });
});
