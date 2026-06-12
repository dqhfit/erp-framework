/* ==========================================================
   prepare-import-items.ts — Dựng items cho migration_start_full_import
   từ danh sách bảng MSSQL còn thiếu trên prod.

   Quy tắc TÊN FIELD = lower(tên cột) PLAIN (KHÔNG snake_case) — khớp
   chính xác worker full-import (dataObj[k.toLowerCase()]) và delta-sync
   (đã vá lowerKeys). KHÔNG dùng snakeCase của discover (IsLock→is_lock
   sẽ trượt key islock).

   Lọc: chỉ BASE TABLE dbo tồn tại trong MSSQL + có PK đơn cột (full
   stream cần); bảng thiếu PK đơn → liệt kê riêng (cần Quick migrate tay).

   Chạy:
     node --env-file=packages/server/.env --import tsx \
       tooling/migration-cli/src/prepare-import-items.ts <file-danh-sách>
   Output: migration-plan/ui/import-items.json + tóm tắt stdout.
   ========================================================== */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MssqlClient } from "@erp-framework/mssql-client";

const ROOT = process.cwd();
const listFile = process.argv[2] ?? resolve(ROOT, "migration-plan", "ui", "missing-tables.txt");
const OUT = resolve(ROOT, "migration-plan", "ui", "import-items.json");

function mapType(dt: string): string {
  const d = dt.toLowerCase();
  if (
    [
      "int",
      "bigint",
      "smallint",
      "tinyint",
      "decimal",
      "numeric",
      "money",
      "smallmoney",
      "float",
      "real",
    ].includes(d)
  ) {
    return "number";
  }
  if (d === "bit") return "boolean";
  if (d === "date") return "date";
  if (["datetime", "datetime2", "smalldatetime", "datetimeoffset"].includes(d)) return "datetime";
  return "text";
}

const wanted = readFileSync(listFile, "utf8")
  .split(/\r?\n/)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
  // bỏ noise: tên CTE/cursor/cross-db đã biết
  .filter((s) => !/^(cur_|daterangecte|rcte)$/.test(s) && !s.includes("."));

const mssql = MssqlClient.fromEnv();
await mssql.connect();
try {
  const tables = await mssql.listTables("dbo");
  const existing = new Map(tables.map((t) => [t.name.toLowerCase(), t.name]));

  const items: Array<{
    tableName: string;
    entityName: string;
    label: string;
    fields: Array<{ name: string; label: string; type: string }>;
  }> = [];
  const notFound: string[] = [];
  const noSinglePk: string[] = [];

  for (const want of wanted) {
    const realName = existing.get(want);
    if (!realName) {
      notFound.push(want);
      continue;
    }
    const info = await mssql.getTable("dbo", realName);
    if (!info) {
      notFound.push(want);
      continue;
    }
    // PK 1-3 cột đều stream được (composite keyset); >3 hoặc không PK → skip.
    if (info.primaryKey.length < 1 || info.primaryKey.length > 3) {
      noSinglePk.push(`${want} (pk: ${info.primaryKey.join("+") || "KHÔNG có"})`);
      continue;
    }
    // LOẠI cột binary (varbinary/image/rowversion): driver trả Buffer →
    // JSON.stringify thành mảng byte khổng lồ trong ext jsonb → OOM worker
    // (đã dính: tr_tieuchuan.NoiDung 2MB/row, tr_thongtin_sanpham_nguyenlieu
    // .HinhAnh 6.5MB/row). Ảnh nhúng không dùng được trong web UI — cần
    // đường migrate file riêng (uploads) nếu muốn giữ.
    const usable = info.columns.filter(
      (c) => !/^(varbinary|image|timestamp|rowversion)$/i.test(c.dataType),
    );
    items.push({
      tableName: `dbo.${realName}`,
      entityName: want,
      label: realName,
      fields: usable.map((c) => ({
        name: c.name.toLowerCase(),
        label: c.name,
        type: mapType(c.dataType),
      })),
    });
  }

  writeFileSync(OUT, JSON.stringify({ items, notFound, noSinglePk }, null, 1), "utf8");
  console.log(
    `items: ${items.length} | không tồn tại MSSQL: ${notFound.length} | thiếu PK đơn: ${noSinglePk.length}`,
  );
  if (notFound.length) console.log("notFound:", notFound.join(", "));
  if (noSinglePk.length) console.log("noSinglePk:", noSinglePk.join("; "));
} finally {
  await mssql.close();
}
