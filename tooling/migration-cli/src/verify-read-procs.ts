/* ==========================================================
   verify-read-procs.ts — Verify runtime proc Tier D ĐỌC:
   chạy proc GỐC trên MSSQL (qua client.query EXEC — user app_dqhf_ro
   read-only tầng SQL) làm golden, chạy proc ĐÃ PORT trên prod PG qua
   MCP migration_invoke_module_proc, rồi so kết quả.

   So sánh HÀNH VI xấp xỉ (theo tinh thần migration-verify.ts):
   - Proc trả dataset: so rowCount + mỗi dòng golden phải tìm được 1
     dòng PG chứa TOÀN BỘ giá trị (multiset-subset, value normalize:
     number làm tròn 6, date về YYYY-MM-DD, bool về true/false) —
     vì dòng PG (listWhere) thường có NHIỀU cột hơn SELECT gốc.
   - Proc trả scalar OUTPUT: so số với dung sai 0.01 tuyệt đối hoặc
     0.1% tương đối.
   LƯU Ý: data PG là mirror sync (lag 15ph/2h) — lệch nhỏ có thể do
   DATA DRIFT chứ không phải logic; report ghi rõ để người đọc xét.

   Chạy:
     MIGRATION_MCP_KEY=... node --env-file=packages/server/.env \
       --import tsx tooling/migration-cli/src/verify-read-procs.ts
   Output: migration-plan/ui/verify-report.md + stdout tóm tắt.
   ========================================================== */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MssqlClient } from "@erp-framework/mssql-client";

const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) {
  console.error("Thiếu env MIGRATION_MCP_KEY");
  process.exit(1);
}

let rpcId = 0;
async function invokePorted(
  name: string,
  args: Record<string, unknown>,
): Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
  rowCount?: number;
  truncated?: boolean;
}> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name: "migration_invoke_module_proc", arguments: { name, args } },
    }),
  });
  const j = (await res.json()) as {
    error?: { message: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  if (j.error) return { ok: false, error: j.error.message };
  const text = j.result?.content?.[0]?.text ?? "";
  if (j.result?.isError) return { ok: false, error: text.slice(0, 300) };
  try {
    return JSON.parse(text) as {
      ok: boolean;
      result?: unknown;
      error?: string;
      rowCount?: number;
      truncated?: boolean;
    };
  } catch {
    return { ok: false, error: `parse fail: ${text.slice(0, 200)}` };
  }
}

/** Escape literal nvarchar cho batch golden (script kiểm soát giá trị). */
const lit = (v: unknown): string => (v == null ? "NULL" : `N'${String(v).replace(/'/g, "''")}'`);

/** Normalize 1 giá trị để so sánh. */
function norm(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return String(Math.round(v * 1e6) / 1e6);
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10); // ISO datetime → date
  // chuỗi số → normalize như number (MSSQL decimal vs PG numeric-as-text)
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(Math.round(Number(s) * 1e6) / 1e6);
  if (s === "true" || s === "false") return s;
  return s;
}

/** Multiset giá trị normalize của 1 row (bỏ null + bỏ uuid v4/v7 nội bộ). */
function rowVals(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (k === "_id" || k === "__sync_hash") continue;
    const n = norm(v);
    if (n == null) continue;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n)) {
      out.push(n.toUpperCase()); // uuid: so case-insensitive (MSSQL trả hoa)
      continue;
    }
    out.push(n);
  }
  return out;
}

/** golden row ⊆ pg row? (mỗi giá trị golden xuất hiện đủ số lần trong pg). */
function rowSubset(golden: string[], pg: string[]): boolean {
  const cnt = new Map<string, number>();
  for (const v of pg) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  for (const v of golden) {
    const c = cnt.get(v) ?? 0;
    if (c <= 0) return false;
    cnt.set(v, c - 1);
  }
  return true;
}

interface CaseResult {
  proc: string;
  caseName: string;
  status: "PASS" | "FAIL" | "SKIP" | "ERROR";
  detail: string;
}

function compareDatasets(
  goldenRows: Array<Record<string, unknown>>,
  pgRows: Array<Record<string, unknown>>,
): { pass: boolean; detail: string } {
  if (goldenRows.length !== pgRows.length) {
    return { pass: false, detail: `rowCount lệch: MSSQL=${goldenRows.length} PG=${pgRows.length}` };
  }
  if (goldenRows.length === 0) return { pass: true, detail: "cả 2 rỗng (0 row)" };
  const pgSets = pgRows.map(rowVals);
  const used = new Array(pgSets.length).fill(false);
  let unmatched = 0;
  let firstMiss = "";
  for (const g of goldenRows) {
    const gv = rowVals(g);
    let hit = -1;
    for (let i = 0; i < pgSets.length; i++) {
      if (!used[i] && rowSubset(gv, pgSets[i] ?? [])) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) used[hit] = true;
    else {
      unmatched++;
      if (!firstMiss) {
        // Báo GIÁ TRỊ golden thiếu so với row PG GẦN nhất (khớp nhiều nhất)
        // — lệch 1 giá trị khó thấy (khoảng trắng/NFC/format) lộ ngay.
        let best: string[] = [];
        let bestMiss = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pgSets.length; i++) {
          if (used[i]) continue;
          const cnt = new Map<string, number>();
          for (const v of pgSets[i] ?? []) cnt.set(v, (cnt.get(v) ?? 0) + 1);
          const miss: string[] = [];
          for (const v of gv) {
            const c = cnt.get(v) ?? 0;
            if (c <= 0) miss.push(v);
            else cnt.set(v, c - 1);
          }
          if (miss.length < bestMiss) {
            bestMiss = miss.length;
            best = miss;
          }
        }
        firstMiss = `thiếu ${JSON.stringify(best.slice(0, 5))} (golden: ${JSON.stringify(gv.slice(0, 8))})`;
      }
    }
  }
  return unmatched === 0
    ? { pass: true, detail: `${goldenRows.length} row khớp (subset-match)` }
    : {
        pass: false,
        detail: `${unmatched}/${goldenRows.length} row golden không tìm thấy bên PG; vd ${firstMiss}`,
      };
}

function compareScalars(
  golden: Record<string, unknown>,
  pg: Record<string, unknown>,
  keys: Array<[string, string]>, // [goldenKey, pgKey]
): { pass: boolean; detail: string } {
  const parts: string[] = [];
  let pass = true;
  for (const [gk, pk] of keys) {
    const g = Number(golden[gk] ?? 0);
    const p = Number(pg[pk] ?? 0);
    const ok = Math.abs(g - p) <= Math.max(0.01, Math.abs(g) * 0.001);
    if (!ok) pass = false;
    parts.push(`${gk}: MSSQL=${g} PG=${p} ${ok ? "✓" : "✗"}`);
  }
  return { pass, detail: parts.join("; ") };
}

async function main() {
  const c = MssqlClient.fromEnv();
  await c.connect();
  const results: CaseResult[] = [];

  const q = <T = Record<string, unknown>>(sqlText: string) => c.query<T>(sqlText);
  const top1 = async (sqlText: string): Promise<Record<string, unknown> | null> => {
    const r = await q(sqlText);
    return r[0] ?? null;
  };

  /** 1 case dataset: golden EXEC vs ported fn. */
  const dsCase = async (
    proc: string,
    caseName: string,
    goldenSql: string,
    portedName: string,
    portedArgs: Record<string, unknown>,
  ) => {
    try {
      const golden = await q(goldenSql);
      const pg = await invokePorted(portedName, portedArgs);
      if (!pg.ok) {
        results.push({ proc, caseName, status: "ERROR", detail: `PG: ${pg.error}` });
        return;
      }
      // Kết quả >200KB bị server CẮT thành string "…(cắt)" — mất dataset
      // nhưng rowCount của response vẫn đúng → fallback so rowCount.
      if (pg.truncated && typeof pg.rowCount === "number") {
        const goldenN = (golden as Array<Record<string, unknown>>).length;
        const pass = goldenN === pg.rowCount;
        results.push({
          proc,
          caseName,
          status: pass ? "PASS" : "FAIL",
          detail: `${pass ? "rowCount khớp" : "rowCount lệch"}: MSSQL=${goldenN} PG=${pg.rowCount} (kết quả lớn bị cắt — chỉ so rowCount)`,
        });
        return;
      }
      const pgRows = Array.isArray(pg.result) ? (pg.result as Array<Record<string, unknown>>) : [];
      const cmp = compareDatasets(golden as Array<Record<string, unknown>>, pgRows);
      results.push({ proc, caseName, status: cmp.pass ? "PASS" : "FAIL", detail: cmp.detail });
    } catch (e) {
      results.push({ proc, caseName, status: "ERROR", detail: (e as Error).message.slice(0, 200) });
    }
  };

  /** 1 case scalar OUTPUT. */
  const scCase = async (
    proc: string,
    caseName: string,
    goldenSql: string, // batch DECLARE/EXEC/SELECT trả 1 dòng outputs
    portedName: string,
    portedArgs: Record<string, unknown>,
    keys: Array<[string, string]>,
  ) => {
    try {
      const golden = await top1(goldenSql);
      if (!golden) {
        results.push({ proc, caseName, status: "ERROR", detail: "golden không trả dòng outputs" });
        return;
      }
      const pg = await invokePorted(portedName, portedArgs);
      if (!pg.ok) {
        results.push({ proc, caseName, status: "ERROR", detail: `PG: ${pg.error}` });
        return;
      }
      const pgRow = Array.isArray(pg.result)
        ? ((pg.result as Array<Record<string, unknown>>)[0] ?? {})
        : ((pg.result ?? {}) as Record<string, unknown>);
      const cmp = compareScalars(golden, pgRow, keys);
      results.push({ proc, caseName, status: cmp.pass ? "PASS" : "FAIL", detail: cmp.detail });
    } catch (e) {
      results.push({ proc, caseName, status: "ERROR", detail: (e as Error).message.slice(0, 200) });
    }
  };

  /* ── Sample inputs từ MSSQL ── */
  const maspGva = (
    await top1(
      `SELECT TOP 1 masp FROM tr_dinhmuc_govan WHERE ISNULL(nguyenlieu,'') NOT IN ('','0') GROUP BY masp HAVING SUM(m3_tc) > 0 ORDER BY masp DESC`,
    )
  )?.masp as string | undefined;
  const maspDgo = (
    await top1(`SELECT TOP 1 masp FROM tr_dinhmuc_donggoi GROUP BY masp ORDER BY masp DESC`)
  )?.masp as string | undefined;
  const maspNki = (
    await top1(`SELECT TOP 1 masp FROM tr_dinhmuc_ngukim GROUP BY masp ORDER BY masp DESC`)
  )?.masp as string | undefined;
  const maspSon = (
    await top1(`SELECT TOP 1 masp FROM tr_dinhmuc_son3 GROUP BY masp ORDER BY masp DESC`)
  )?.masp as string | undefined;
  const lcp = (
    await top1(
      `SELECT TOP 1 lenhcapphatid FROM tr_lenhcapphat WHERE active = 1 ORDER BY lenhcapphatid DESC`,
    )
  )?.lenhcapphatid as string | undefined;
  const lockRow = await top1(
    `SELECT TOP 1 B.masp_nhamay, B.mausac, A.loaidinhmuc FROM tr_dinhmuc_lock A JOIN tr_sanpham B ON A.masp = B.masp WHERE ISNULL(B.masp_nhamay,'') <> '' ORDER BY A.masp DESC`,
  );
  const cardNo = (await top1(`SELECT TOP 1 card_no FROM tr_pallet_card ORDER BY card_no DESC`))
    ?.card_no as string | undefined;
  const ngayCs = (
    await top1(
      `SELECT TOP 1 CONVERT(varchar(10), ngaythang, 23) AS d FROM tr_trangthai_sanxuat WHERE congdoan LIKE '%-PROD' ORDER BY ngaythang DESC`,
    )
  )?.d as string | undefined;
  const khuvuc = (await top1(`SELECT TOP 1 makhuvuc FROM tr_tiendo_chuyenson ORDER BY makhuvuc`))
    ?.makhuvuc as string | undefined;
  const ddhTinhgia = (
    await top1(
      `SELECT TOP 1 madonhang FROM tr_trangthai_sanxuat WHERE congdoan LIKE '%-PROD' AND madonhang IS NOT NULL ORDER BY ngaythang DESC`,
    )
  )?.madonhang as string | undefined;

  /* ── Cases ── */
  await dsCase(
    "TR_ORDER_ISLOCK",
    "is_lock=false",
    `EXEC dbo.TR_ORDER_ISLOCK @IsLock = 0`,
    "trOrderIslock",
    { is_lock: false },
  );
  await dsCase(
    "TR_ORDER_ISLOCK",
    "is_lock=true",
    `EXEC dbo.TR_ORDER_ISLOCK @IsLock = 1`,
    "trOrderIslock",
    { is_lock: true },
  );
  if (maspGva) {
    await dsCase(
      "TR_DINHMUC_GOVAN_M3TOTAL",
      `masp=${maspGva}`,
      `EXEC dbo.TR_DINHMUC_GOVAN_M3TOTAL @MASP = ${lit(maspGva)}, @SOLUONG = 2`,
      "trDinhmucGovanM3total",
      { masp: maspGva, soluong: 2 },
    );
    await scCase(
      "TINHGIA_NGUYENLIEU_GVA",
      `masp=${maspGva}`,
      `DECLARE @a decimal(18,2), @b decimal(18,5); EXEC dbo.TINHGIA_NGUYENLIEU_GVA ${lit(maspGva)}, 25400, @a OUTPUT, @b OUTPUT; SELECT @a AS tongdongia_vnd, @b AS tongkhoitinhche;`,
      "tinhgiaNguyenlieuGva",
      { masp: maspGva },
      [
        ["tongdongia_vnd", "tongdongia_vnd"],
        ["tongkhoitinhche", "tongkhoitinhche"],
      ],
    );
    await scCase(
      "TINHGIA_NGUYENLIEU_GVA2",
      `masp=${maspGva}`,
      `DECLARE @a decimal(18,2), @b decimal(18,5); EXEC dbo.TINHGIA_NGUYENLIEU_GVA2 ${lit(maspGva)}, 25400, @a OUTPUT, @b OUTPUT; SELECT @a AS tongdongia_vnd, @b AS tongkhoitinhche;`,
      "tinhgiaNguyenlieuGva2",
      { masp: maspGva },
      [
        ["tongdongia_vnd", "tongdongia_vnd"],
        ["tongkhoitinhche", "tongkhoitinhche"],
      ],
    );
  }
  if (maspDgo) {
    await scCase(
      "TINHGIA_NGUYENLIEU_DGO",
      `masp=${maspDgo}`,
      `DECLARE @a decimal(18,2); EXEC dbo.TINHGIA_NGUYENLIEU_DGO ${lit(maspDgo)}, 25400, @a OUTPUT; SELECT @a AS tongdonagia_vnd;`,
      "tinhgiaNguyenlieuDgo",
      { masp: maspDgo },
      [["tongdonagia_vnd", "tongdonagia_vnd"]],
    );
  }
  if (maspNki) {
    await scCase(
      "TINHGIA_NGUYENLIEU_NKI",
      `masp=${maspNki}`,
      `DECLARE @a decimal(18,2); EXEC dbo.TINHGIA_NGUYENLIEU_NKI ${lit(maspNki)}, 25400, @a OUTPUT; SELECT @a AS tongdonagia_vnd;`,
      "tinhgiaNguyenlieuNki",
      { masp: maspNki },
      [["tongdonagia_vnd", "tongdonagia_vnd"]],
    );
    await dsCase(
      "TR_DINHMUC_NGUKIM_TOTALMAVT",
      `masp=${maspNki}`,
      `EXEC dbo.TR_DINHMUC_NGUKIM_TOTALMAVT @MASP = ${lit(maspNki)}, @SOLUONG = 2`,
      "trDinhmucNgukimTotalmavt",
      { masp: maspNki, soluong: 2 },
    );
  }
  if (maspSon) {
    await scCase(
      "TINHGIA_NGUYENLIEU_SON",
      `masp=${maspSon}`,
      `DECLARE @a decimal(18,2), @b decimal(18,2); EXEC dbo.TINHGIA_NGUYENLIEU_SON ${lit(maspSon)}, 25400, @a OUTPUT, @b OUTPUT; SELECT @a AS tongdongia_sanpham, @b AS tongdongia_metvuong;`,
      "tinhgiaNguyenlieuSon",
      { masp: maspSon },
      [
        ["tongdongia_sanpham", "tongdongia_sanpham"],
        ["tongdongia_metvuong", "tongdongia_metvuong"],
      ],
    );
  }
  if (lcp) {
    await dsCase(
      "TR_LENHCAPPHAT_SUMBYMACT",
      `lcp=${lcp}`,
      `EXEC dbo.TR_LENHCAPPHAT_SUMBYMACT @LenhCapPhatID = ${lit(lcp)}`,
      "trLenhcapphatSumbymact",
      { lenh_cap_phat_id: lcp },
    );
  }
  if (lockRow) {
    await dsCase(
      "TR_DINHMUC_LOCK_GET2",
      `masp_nhamay=${lockRow.masp_nhamay}`,
      `EXEC dbo.TR_DINHMUC_LOCK_GET2 @masp_nhamay = ${lit(lockRow.masp_nhamay)}, @mausac = ${lit(lockRow.mausac)}, @loaidinhmuc = ${lit(lockRow.loaidinhmuc)}`,
      "trDinhmucLockGet2",
      {
        masp_nhamay: lockRow.masp_nhamay,
        mausac: lockRow.mausac,
        loaidinhmuc: lockRow.loaidinhmuc,
      },
    );
  }
  if (cardNo) {
    await dsCase(
      "TR_PALLET_CARD_GETNGUOIDUYET",
      `card=${cardNo}`,
      `EXEC dbo.TR_PALLET_CARD_GETNGUOIDUYET @card_no = ${lit(cardNo)}`,
      "trPalletCardGetnguoiduyet",
      { card_no: cardNo },
    );
  }
  if (ngayCs) {
    await dsCase(
      "TR_BAOCAO_CHUYENSON_GETDATA",
      `ngay=${ngayCs}`,
      `EXEC dbo.TR_BAOCAO_CHUYENSON_GETDATA @ngaythang = ${lit(ngayCs)}`,
      "trBaocaoChuyensonGetdata",
      { ngaythang: ngayCs },
    );
  }
  await dsCase(
    "TR_DONDATHANG_SUMBYYEAR",
    "year=2026",
    `EXEC dbo.TR_DONDATHANG_SUMBYYEAR @year = 2026`,
    "trDondathangSumbyyear",
    { year: 2026 },
  );
  if (khuvuc) {
    await dsCase(
      "TR_TIENDO_CHUYENSON_GETBYKHUVUC",
      `khuvuc=${khuvuc}`,
      `EXEC dbo.TR_TIENDO_CHUYENSON_GETBYKHUVUC @makhuvuc = ${lit(khuvuc)}`,
      "trTiendoChuyensonGetbykhuvuc",
      { makhuvuc: khuvuc },
    );
  }
  if (ddhTinhgia) {
    await dsCase(
      "TR_TINHGIA_BY_DDH",
      `ddh=${ddhTinhgia}`,
      `EXEC dbo.TR_TINHGIA_BY_DDH @madonhang = ${lit(ddhTinhgia)}`,
      "trTinhgiaByDdh",
      { madonhang: ddhTinhgia },
    );
  }

  await c.close();

  /* ── Report ── */
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const err = results.filter((r) => r.status === "ERROR").length;
  const lines = [
    "# Verify runtime proc Tier D đọc — golden MSSQL vs port PG (prod)",
    "",
    `Ngày chạy xem git log. Kết quả: **${pass} PASS / ${fail} FAIL / ${err} ERROR** trên ${results.length} case.`,
    "",
    "LƯU Ý: data PG là mirror (sync lag 15ph core / 2h heavy) — FAIL về số",
    "row/giá trị có thể do DATA DRIFT tại thời điểm chạy, cần xét từng case.",
    "",
    "| Proc | Case | KQ | Chi tiết |",
    "|---|---|---|---|",
    ...results.map(
      (r) => `| ${r.proc} | ${r.caseName} | ${r.status} | ${r.detail.replace(/\|/g, "\\|")} |`,
    ),
  ];
  writeFileSync(
    resolve(process.cwd(), "migration-plan/ui/verify-report.md"),
    lines.join("\n"),
    "utf8",
  );
  console.log(
    `\n=== VERIFY: ${pass} PASS / ${fail} FAIL / ${err} ERROR (${results.length} case) ===`,
  );
  for (const r of results)
    console.log(`${r.status.padEnd(5)} ${r.proc} [${r.caseName}] — ${r.detail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
