import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

/* ==========================================================
   gen_dinh_muc_son — Sinh/GHI ĐÈ định mức sơn (tr_dinhmuc_son) cho các sản phẩm
   theo phiên bản BOM sơn đã gán (tr_sanpham.bom_son_version_id).

   Quan hệ: phiên bản → tr_quytrinh_son (bước, theo f_id_phienban) →
            tr_quytrinh_son_chitiet (vật tư, theo f_id_quytrinh).
   Mỗi (bước × vật tư) = 1 dòng định mức.

   Quy tắc giá trị:
   - f_m2     = tr_sanpham.m2_son
   - f_sl_m2  = định lượng QUY ĐỔI KG = tr_quytrinh_son_chitiet.dinhluong / 1000  (g/m² → kg/m²)
   - f_sl_sp  = f_sl_m2 × f_m2  (kg cho cả sản phẩm)
   - f_tenct/f_dvt/f_nhom lấy theo tr_material (mã = f_mact)
   GHI ĐÈ: xoá hết dòng định mức cũ của masp trước khi tạo lại.
   ========================================================== */
export async function genDinhMucSon(
  db: DB,
  companyId: string,
  args: { productIds?: string[] },
): Promise<{ message: string; products: number; rows: number }> {
  const ids = (args.productIds ?? []).filter((x): x is string => typeof x === "string" && x.length > 0);
  if (ids.length === 0) {
    return { message: "Không có sản phẩm để tạo định mức", products: 0, rows: 0 };
  }
  const idArr = sql`ARRAY[${sql.join(
    ids.map((s) => sql`${s}`),
    sql`, `,
  )}]::uuid[]`;

  return await db.transaction(async (tx) => {
    // Entity id tr_dinhmuc_son (ghi record_locator) — tra theo TÊN cho portable dev/prod.
    const eRows = (await tx.execute(
      sql`SELECT id FROM entities WHERE company_id = ${companyId} AND name = 'tr_dinhmuc_son' LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    const dmEntityId = eRows[0]?.id;
    if (!dmEntityId) throw new Error("Không tìm thấy entity tr_dinhmuc_son");

    // Mã SP hợp lệ (đã gán phiên bản) trong tập chọn.
    const prodRows = (await tx.execute(sql`
      SELECT DISTINCT f_masp AS masp FROM tr_sanpham
      WHERE company_id = ${companyId} AND id = ANY(${idArr})
        AND f_bom_son_version_id IS NOT NULL AND f_masp IS NOT NULL AND f_masp <> ''
    `)) as unknown as Array<{ masp: string }>;
    const masps = prodRows.map((r) => r.masp).filter(Boolean);
    if (masps.length === 0) {
      return { message: "Sản phẩm chưa gán phiên bản BOM sơn", products: 0, rows: 0 };
    }
    const maspArr = sql`ARRAY[${sql.join(
      masps.map((s) => sql`${s}`),
      sql`, `,
    )}]::text[]`;

    // GHI ĐÈ: xoá locator + dòng định mức cũ của các masp này.
    await tx.execute(sql`
      DELETE FROM record_locator WHERE company_id = ${companyId}
        AND id IN (SELECT id FROM tr_dinhmuc_son WHERE company_id = ${companyId} AND f_masp = ANY(${maspArr}))
    `);
    await tx.execute(sql`
      DELETE FROM tr_dinhmuc_son WHERE company_id = ${companyId} AND f_masp = ANY(${maspArr})
    `);

    // Tạo dòng định mức mới + record_locator (data-modifying CTE).
    const ins = (await tx.execute(sql`
      WITH ins AS (
        INSERT INTO tr_dinhmuc_son (
          id, company_id, f_masp, f_stt, f_buoc, f_id_buocson, f_mact, f_tenct,
          f_m2, f_sl_m2, f_sl_sp, f_dvt, f_nhom, f_mamau, f_id_phienban, f_c_level, f_t_sort,
          f_ngaytao, ext, version, rollup_invalidated, created_at, updated_at
        )
        SELECT
          uuidv7(), p.company_id, p.f_masp, q.f_stt, q.f_tenbuocson, q.f_id_buocson,
          c.f_mact, COALESCE(m.f_tenvt, c.f_mact),
          COALESCE(p.f_m2_son, 0),
          c.f_dinhluong / 1000.0,
          (c.f_dinhluong / 1000.0) * COALESCE(p.f_m2_son, 0),
          'Kg', m.f_nhom, p.f_mausac, p.f_bom_son_version_id, 0, 0,
          now()::text, '{}'::jsonb, 0, true, now(), now()
        FROM tr_sanpham p
        JOIN tr_quytrinh_son q
          ON q.company_id = p.company_id
         AND q.f_id_phienban = p.f_bom_son_version_id
         AND q.deleted_at IS NULL
        JOIN tr_quytrinh_son_chitiet c
          ON c.company_id = p.company_id
         AND c.f_id_quytrinh::text = q.f_id_quytrinh::text
         AND c.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT f_tenvt, f_dvt, f_nhom FROM tr_material
          WHERE company_id = p.company_id AND f_mavt = c.f_mact AND deleted_at IS NULL
          LIMIT 1
        ) m ON true
        WHERE p.company_id = ${companyId} AND p.id = ANY(${idArr})
          AND p.f_bom_son_version_id IS NOT NULL
        RETURNING id, company_id
      ), loc AS (
        INSERT INTO record_locator (id, company_id, entity_id)
        SELECT id, company_id, ${dmEntityId}::uuid FROM ins
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT count(*)::int AS n FROM ins
    `)) as unknown as Array<{ n: number }>;

    const rowsCreated = ins[0]?.n ?? 0;
    return {
      message: `Đã ghi đè định mức sơn: ${rowsCreated} dòng cho ${masps.length} sản phẩm`,
      products: masps.length,
      rows: rowsCreated,
    };
  });
}
