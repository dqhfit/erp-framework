/* Setup MỘT LẦN cho trang 9f2b1aa2 (Tính mét vuông sơn) trên PROD: tạo bảng +
   entity + trigger cho CỤM SƠN và DIỆN TÍCH MẶT SƠN, rồi TÍNH LẠI dữ liệu cụm
   sơn TỪ tr_sanpham CỦA PROD (không copy data dev). Chạy qua
   migration_invoke_module_proc. Idempotent. Xoá file được sau khi chạy.

   - tr_cumson_sanpham: mỗi SP không-tháo-rời × 12 cụm; diện tích gốc = chiều1×chiều2/1e6;
     trigger giữ diện tích sơn = gốc × phần_trăm/100.
   - tr_dientich_matson: bảng rỗng (proc Lưu sẽ ghi khi user bấm Lưu). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";

const CUMSON = {
  id: "f0c5a001-0000-4000-8000-000000000001",
  name: "tr_cumson_sanpham",
  label: "Cụm sơn theo sản phẩm",
  fields: [
    {
      name: "masp",
      type: "text",
      label: "Mã sản phẩm",
    },
    {
      name: "stt",
      type: "number",
      label: "STT",
    },
    {
      name: "ma_cum",
      type: "text",
      label: "Mã cụm sơn",
    },
    {
      name: "ten_cum",
      type: "text",
      label: "Tên cụm sơn",
    },
    {
      name: "vitri",
      type: "text",
      label: "Vị trí",
    },
    {
      name: "matson",
      type: "text",
      label: "Mặt sơn",
    },
    {
      name: "quycach",
      type: "text",
      label: "Quy cách",
    },
    {
      name: "phantram_son",
      type: "number",
      label: "Phần trăm sơn (%)",
    },
    {
      name: "dientich_base",
      type: "number",
      label: "Diện tích gốc (m²)",
    },
    {
      name: "dientich_son",
      type: "number",
      label: "Diện tích sơn (m²)",
    },
  ],
  meta: {
    sync: {
      state: "live",
    },
    storage: {
      tier: "table",
      columns: {
        stt: {
          col: "f_stt",
          pgType: "numeric",
        },
        masp: {
          col: "f_masp",
          pgType: "text",
        },
        vitri: {
          col: "f_vitri",
          pgType: "text",
        },
        ma_cum: {
          col: "f_ma_cum",
          pgType: "text",
        },
        matson: {
          col: "f_matson",
          pgType: "text",
        },
        quycach: {
          col: "f_quycach",
          pgType: "text",
        },
        ten_cum: {
          col: "f_ten_cum",
          pgType: "text",
        },
        dientich_son: {
          col: "f_dientich_son",
          pgType: "numeric",
        },
        phantram_son: {
          col: "f_phantram_son",
          pgType: "numeric",
        },
        dientich_base: {
          col: "f_dientich_base",
          pgType: "numeric",
        },
      },
      tableName: "tr_cumson_sanpham",
    },
  },
} as const;
const DTMS = {
  id: "f0c5a002-0000-4000-8000-000000000001",
  name: "tr_dientich_matson",
  label: "Diện tích mặt sơn (đã lưu)",
  fields: [
    {
      name: "masp",
      type: "text",
      label: "Mã sản phẩm",
    },
    {
      name: "loai",
      type: "text",
      label: "Loại tính",
    },
    {
      name: "stt",
      type: "number",
      label: "STT",
    },
    {
      name: "ma_cum",
      type: "text",
      label: "Mã cụm / chi tiết",
    },
    {
      name: "ten_cum",
      type: "text",
      label: "Tên cụm / chi tiết",
    },
    {
      name: "quycach",
      type: "text",
      label: "Quy cách",
    },
    {
      name: "phantram_son",
      type: "number",
      label: "Phần trăm sơn (%)",
    },
    {
      name: "dientich",
      type: "number",
      label: "Diện tích (m²)",
    },
    {
      name: "tong_m2",
      type: "number",
      label: "Tổng m² sơn",
    },
    {
      name: "ngaytinh",
      type: "text",
      label: "Ngày tính",
    },
  ],
  meta: {
    sync: {
      state: "live",
    },
    storage: {
      tier: "table",
      columns: {
        stt: {
          col: "f_stt",
          pgType: "numeric",
        },
        loai: {
          col: "f_loai",
          pgType: "text",
        },
        masp: {
          col: "f_masp",
          pgType: "text",
        },
        ma_cum: {
          col: "f_ma_cum",
          pgType: "text",
        },
        quycach: {
          col: "f_quycach",
          pgType: "text",
        },
        ten_cum: {
          col: "f_ten_cum",
          pgType: "text",
        },
        tong_m2: {
          col: "f_tong_m2",
          pgType: "numeric",
        },
        dientich: {
          col: "f_dientich",
          pgType: "numeric",
        },
        ngaytinh: {
          col: "f_ngaytinh",
          pgType: "text",
        },
        phantram_son: {
          col: "f_phantram_son",
          pgType: "numeric",
        },
      },
      tableName: "tr_dientich_matson",
    },
  },
} as const;

async function upsertEntity(
  db: DB,
  companyId: string,
  e: { id: string; name: string; label: string; fields: unknown; meta: unknown },
) {
  await db.execute(sql`
    INSERT INTO entities (id, company_id, name, label, fields, meta, created_at, updated_at)
    VALUES (${e.id}::uuid, ${companyId}::uuid, ${e.name}, ${e.label}, ${JSON.stringify(e.fields)}::jsonb, ${JSON.stringify(e.meta)}::jsonb, now(), now())
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, label=EXCLUDED.label, fields=EXCLUDED.fields, meta=EXCLUDED.meta, updated_at=now()
  `);
}

export async function setupCumsonProd(
  db: DB,
  companyId: string,
  _args: Record<string, unknown>,
): Promise<Array<{ ok: boolean; cumson_rows: number; message: string }>> {
  // 1) Bảng cụm sơn (HYBRID).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tr_cumson_sanpham (
      id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL, ext jsonb NOT NULL DEFAULT '{}'::jsonb,
      version int NOT NULL DEFAULT 0, deleted_at timestamptz, search_tsv tsvector, rollup_cache jsonb,
      rollup_invalidated boolean NOT NULL DEFAULT true, created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      f_masp text, f_stt numeric, f_ma_cum text, f_ten_cum text, f_vitri text, f_matson text,
      f_quycach text, f_phantram_son numeric DEFAULT 100, f_dientich_base numeric, f_dientich_son numeric)
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_cumson_sp_masp ON tr_cumson_sanpham (company_id, f_masp) WHERE deleted_at IS NULL`,
  );

  // 2) Bảng diện tích mặt sơn (lịch sử Lưu) — rỗng.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tr_dientich_matson (
      id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL, ext jsonb NOT NULL DEFAULT '{}'::jsonb,
      version int NOT NULL DEFAULT 0, deleted_at timestamptz, search_tsv tsvector, rollup_cache jsonb,
      rollup_invalidated boolean NOT NULL DEFAULT true, created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      f_masp text, f_loai text, f_stt numeric, f_ma_cum text, f_ten_cum text, f_quycach text,
      f_phantram_son numeric, f_dientich numeric, f_tong_m2 numeric, f_ngaytinh text)
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_dtms_masp ON tr_dientich_matson (company_id, f_masp) WHERE deleted_at IS NULL`,
  );

  // 3) Trigger: diện tích sơn = diện tích gốc × phần trăm / 100.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION trg_cumson_dientich() RETURNS trigger AS $fn$
    BEGIN
      NEW.f_dientich_son := CASE WHEN NEW.f_dientich_base IS NULL THEN NULL
        ELSE round(NEW.f_dientich_base * coalesce(NEW.f_phantram_son, 100) / 100.0, 5) END;
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql
  `);
  await db.execute(sql`DROP TRIGGER IF EXISTS cumson_dientich ON tr_cumson_sanpham`);
  await db.execute(
    sql`CREATE TRIGGER cumson_dientich BEFORE INSERT OR UPDATE ON tr_cumson_sanpham FOR EACH ROW EXECUTE FUNCTION trg_cumson_dientich()`,
  );

  // 4) Đăng ký entity.
  await upsertEntity(db, companyId, CUMSON);
  await upsertEntity(db, companyId, DTMS);

  // 5) TÍNH LẠI cụm sơn từ tr_sanpham CỦA PROD (SP không tháo rời × 12 cụm).
  await db.execute(sql`DELETE FROM tr_cumson_sanpham WHERE company_id = ${companyId}::uuid`);
  await db.execute(sql`
    INSERT INTO tr_cumson_sanpham (company_id, f_masp, f_stt, f_ma_cum, f_ten_cum, f_vitri, f_matson, f_quycach, f_dientich_base, f_phantram_son)
    SELECT ${companyId}::uuid, p.f_masp, c.stt, c.ma_cum, c.ten_cum, c.vitri, c.matson,
      CASE WHEN c.d1 IS NULL OR c.d2 IS NULL THEN NULL
        ELSE rtrim(rtrim(to_char(c.d1,'FM999999999990.999'),'0'),'.') || ' x ' || rtrim(rtrim(to_char(c.d2,'FM999999999990.999'),'0'),'.') END,
      CASE WHEN c.d1 IS NULL OR c.d2 IS NULL THEN NULL ELSE round(c.d1*c.d2/1000000.0,5) END, 100
    FROM tr_sanpham p
    CROSS JOIN LATERAL (VALUES
      (1::int,'dinh_matngoai','Đỉnh (Mặt ngoài)','dinh','ngoai',p.f_dai,p.f_rong),
      (2,'dinh_mattrong','Đỉnh (Mặt trong)','dinh','trong',p.f_dai,p.f_rong),
      (3,'hongtrai_matngoai','Hông trái (Mặt ngoài)','hongtrai','ngoai',p.f_rong,p.f_cao),
      (4,'hongtrai_mattrong','Hông trái (Mặt trong)','hongtrai','trong',p.f_rong,p.f_cao),
      (5,'hongphai_matngoai','Hông phải (Mặt ngoài)','hongphai','ngoai',p.f_rong,p.f_cao),
      (6,'hongphai_mattrong','Hông phải (Mặt trong)','hongphai','trong',p.f_rong,p.f_cao),
      (7,'day_matngoai','Đáy (Mặt ngoài)','day','ngoai',p.f_dai,p.f_rong),
      (8,'day_mattrong','Đáy (Mặt trong)','day','trong',p.f_dai,p.f_rong),
      (9,'truoc_matngoai','Mặt trước (Mặt ngoài)','truoc','ngoai',p.f_cao,p.f_dai),
      (10,'truoc_mattrong','Mặt trước (Mặt trong)','truoc','trong',p.f_cao,p.f_dai),
      (11,'sau_matngoai','Mặt sau (Mặt ngoài)','sau','ngoai',p.f_cao,p.f_dai),
      (12,'sau_mattrong','Mặt sau (Mặt trong)','sau','trong',p.f_cao,p.f_dai)
    ) AS c(stt, ma_cum, ten_cum, vitri, matson, d1, d2)
    WHERE p.company_id = ${companyId}::uuid AND p.deleted_at IS NULL AND coalesce(p.f_ketcau,'') <> 'Tháo rời'
  `);

  // 6) record_locator cho dòng cụm sơn.
  await db.execute(sql`
    INSERT INTO record_locator (id, company_id, entity_id)
    SELECT id, company_id, ${CUMSON.id}::uuid FROM tr_cumson_sanpham WHERE company_id = ${companyId}::uuid
    ON CONFLICT (id) DO NOTHING
  `);

  const cnt = await db.execute(
    sql`SELECT count(*)::int AS n FROM tr_cumson_sanpham WHERE company_id = ${companyId}::uuid`,
  );
  const n = Array.isArray(cnt)
    ? (cnt[0] as { n: number }).n
    : ((cnt as { rows: { n: number }[] }).rows[0]?.n ?? 0);
  return [
    {
      ok: true,
      cumson_rows: n,
      message: `Đã tạo cụm sơn + diện tích mặt sơn; tính ${n} dòng cụm sơn từ SP prod.`,
    },
  ];
}
