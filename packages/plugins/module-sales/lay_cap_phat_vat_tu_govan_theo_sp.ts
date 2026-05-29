import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function layCapPhatVatTuGovanTheoSp(
  db: DB,
  companyId: string,
  args: {
    ma_don_hang: string;
    ma_sp?: string;
    filter?: string;
  },
): Promise<
  Array<{
    id: string;
    ma_don_hang: string;
    ma_sp: string;
    ten_sp: string;
    nguyen_lieu: string | null;
    ty_le_hao_hut: number | null;
    so_khoi_don_hang: number | null;
    so_khoi_da_nhan: number | null;
    so_khoi_con_lai: number | null;
    so_khoi_vuot: number | null;
    so_khoi_da_yeu_cau: number | null;
    so_khoi_yeu_cau: number;
    selected: boolean;
  }>
> {
  if (!args.ma_don_hang) throw new Error("Thiếu ma_don_hang");

  // Xử lý danh sách mã SP — thay thế fn_Split(@MaSP, ',') của T-SQL
  const dsMaSp = args.ma_sp
    ? args.ma_sp
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // Điều kiện lọc theo danh sách mã SP nếu được truyền vào.
  // LƯU Ý: KHÔNG dùng `ANY(${dsMaSp}::text[])` — drizzle splat mảng JS thành
  // danh sách param (record) → Postgres "cannot cast record to text[]". Phải
  // dựng ARRAY[$1, $2, ...] bằng sql.join để bind đúng mảng text.
  const maSpCondition =
    dsMaSp.length > 0
      ? sql`AND er_cp.data->>'ma_sp' = ANY(ARRAY[${sql.join(
          dsMaSp.map((s) => sql`${s}`),
          sql`, `,
        )}]::text[])`
      : sql``;

  // Điều kiện REMAIN: số khối còn lại > 0; FINISH: = 0; không truyền: lấy tất cả
  const filterCondition =
    args.filter === "REMAIN"
      ? sql`AND (er_cp.data->>'so_khoi_con_lai')::numeric > 0`
      : args.filter === "FINISH"
        ? sql`AND (er_cp.data->>'so_khoi_con_lai')::numeric = 0`
        : sql``;

  const r = await db.execute<{
    id: string;
    ma_don_hang: string;
    ma_sp: string;
    ten_sp: string;
    nguyen_lieu: string | null;
    ty_le_hao_hut: number | null;
    so_khoi_don_hang: number | null;
    so_khoi_da_nhan: number | null;
    so_khoi_con_lai: number | null;
    so_khoi_vuot: number | null;
    so_khoi_da_yeu_cau: number | null;
    so_khoi_yeu_cau: number;
    selected: boolean;
  }>(sql`
    SELECT
      er_cp.id,
      er_cp.data->>'ma_don_hang'                     AS ma_don_hang,
      er_sp.data->>'ma_sp'                           AS ma_sp,
      er_sp.data->>'ten_sp'                          AS ten_sp,
      er_cp.data->>'nguyen_lieu'                     AS nguyen_lieu,
      (er_cp.data->>'ty_le_hao_hut')::numeric        AS ty_le_hao_hut,
      (er_cp.data->>'so_khoi_don_hang')::numeric     AS so_khoi_don_hang,
      (er_cp.data->>'so_khoi_da_nhan')::numeric      AS so_khoi_da_nhan,
      (er_cp.data->>'so_khoi_con_lai')::numeric      AS so_khoi_con_lai,
      (er_cp.data->>'so_khoi_vuot')::numeric         AS so_khoi_vuot,
      (er_cp.data->>'so_khoi_da_yeu_cau')::numeric   AS so_khoi_da_yeu_cau,
      CAST(0 AS DECIMAL(18, 5))                      AS so_khoi_yeu_cau,
      false                                          AS selected
    FROM entity_records er_cp
    JOIN entities e_cp
      ON e_cp.id = er_cp.entity_id AND e_cp.name = 'cap_phat_vat_tu_govan'
    JOIN entity_records er_sp
      ON er_sp.data->>'ma_sp' = er_cp.data->>'ma_sp'
      AND er_sp.company_id = ${companyId}
    JOIN entities e_sp
      ON e_sp.id = er_sp.entity_id AND e_sp.name = 'san_pham'
    WHERE er_cp.company_id = ${companyId}
      AND er_cp.data->>'ma_don_hang' = ${args.ma_don_hang}
      ${maSpCondition}
      ${filterCondition}
  `);

  return r as unknown as Array<{
    id: string;
    ma_don_hang: string;
    ma_sp: string;
    ten_sp: string;
    nguyen_lieu: string | null;
    ty_le_hao_hut: number | null;
    so_khoi_don_hang: number | null;
    so_khoi_da_nhan: number | null;
    so_khoi_con_lai: number | null;
    so_khoi_vuot: number | null;
    so_khoi_da_yeu_cau: number | null;
    so_khoi_yeu_cau: number;
    selected: boolean;
  }>;
}
