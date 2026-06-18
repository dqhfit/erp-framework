/* Setup MỘT LẦN: đăng ký entity + datasource cho trang 4d99a411 (Định mức màu
   sơn) trên PROD — nơi đã có sẵn 2 BẢNG dữ liệu (tr_quytrinh_son,
   tr_quytrinh_son_chitiet) nhưng THIẾU entity/datasource/locator nên trang lỗi.

   MCP không có tool tạo entity → chạy qua migration_invoke_module_proc.
   Idempotent (ON CONFLICT / IF NOT EXISTS) — gọi lại vô hại. KHÔNG đụng dữ liệu
   bảng (giữ nguyên 55/154 dòng prod). Sau khi chạy xong có thể xoá file này. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";

const ENTITIES = [
  {
    id: "c8103d79-9a40-4cb2-9854-f12f7da11d1b",
    name: "tr_quytrinh_son",
    label: "Quy trình sơn",
    icon: null,
    fields: [
      {
        name: "id_quytrinh",
        type: "sequence",
        label: "ID quy trình",
      },
      {
        name: "id_mausac",
        type: "number",
        label: "ID màu sắc",
      },
      {
        name: "mausac",
        type: "text",
        label: "Màu sắc",
      },
      {
        name: "stt",
        type: "number",
        label: "STT",
      },
      {
        name: "id_buocson",
        type: "number",
        label: "ID bước sơn",
      },
      {
        name: "tenbuocson",
        type: "text",
        label: "Tên bước sơn",
      },
      {
        name: "donhot",
        type: "text",
        label: "Độ nhớt",
      },
      {
        name: "phuongphap",
        type: "text",
        label: "Phương pháp",
      },
      {
        name: "tongsoluong",
        type: "number",
        label: "Tổng số lượng",
      },
      {
        name: "thoigiankho",
        type: "text",
        label: "Thời gian khô",
      },
      {
        name: "tongtylepha",
        type: "number",
        label: "Tổng tỷ lệ pha",
      },
      {
        name: "is_active",
        type: "boolean",
        label: "Hoạt động",
      },
      {
        name: "nhacungcap",
        type: "text",
        label: "Nhà cung cấp",
      },
      {
        name: "isbgd_duyet",
        type: "boolean",
        label: "BGĐ duyệt",
      },
      {
        name: "bgd_nguoiduyet",
        type: "text",
        label: "BGĐ người duyệt",
      },
      {
        name: "bgd_ngayduyet",
        type: "datetime",
        label: "BGĐ ngày duyệt",
      },
      {
        name: "nguoitao",
        type: "text",
        label: "Người tạo",
      },
      {
        name: "ngaytao",
        type: "datetime",
        label: "Ngày tạo",
      },
      {
        name: "nguoisua",
        type: "text",
        label: "Người sửa",
      },
      {
        name: "ngaysua",
        type: "datetime",
        label: "Ngày sửa",
      },
      {
        ref: "75a7b609-a322-4808-9cd8-4635090e603f",
        name: "color_ref",
        type: "lookup",
        label: "Màu sơn",
        filterable: true,
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
          donhot: {
            col: "f_donhot",
            pgType: "text",
          },
          mausac: {
            col: "f_mausac",
            pgType: "text",
          },
          ngaysua: {
            col: "f_ngaysua",
            pgType: "text",
          },
          ngaytao: {
            col: "f_ngaytao",
            pgType: "text",
          },
          nguoisua: {
            col: "f_nguoisua",
            pgType: "text",
          },
          nguoitao: {
            col: "f_nguoitao",
            pgType: "text",
          },
          color_ref: {
            col: "f_color_ref",
            pgType: "text",
          },
          id_mausac: {
            col: "f_id_mausac",
            pgType: "numeric",
          },
          is_active: {
            col: "f_is_active",
            pgType: "boolean",
          },
          id_buocson: {
            col: "f_id_buocson",
            pgType: "numeric",
          },
          nhacungcap: {
            col: "f_nhacungcap",
            pgType: "text",
          },
          phuongphap: {
            col: "f_phuongphap",
            pgType: "text",
          },
          tenbuocson: {
            col: "f_tenbuocson",
            pgType: "text",
          },
          id_quytrinh: {
            col: "f_id_quytrinh",
            pgType: "text",
          },
          isbgd_duyet: {
            col: "f_isbgd_duyet",
            pgType: "boolean",
          },
          thoigiankho: {
            col: "f_thoigiankho",
            pgType: "text",
          },
          tongsoluong: {
            col: "f_tongsoluong",
            pgType: "numeric",
          },
          tongtylepha: {
            col: "f_tongtylepha",
            pgType: "numeric",
          },
          bgd_ngayduyet: {
            col: "f_bgd_ngayduyet",
            pgType: "text",
          },
          bgd_nguoiduyet: {
            col: "f_bgd_nguoiduyet",
            pgType: "text",
          },
        },
        version: 2,
        tableName: "tr_quytrinh_son",
        searchable: [],
      },
    },
  },
  {
    id: "4d52f2b2-0098-494f-add1-2f33ba47e082",
    name: "tr_quytrinh_son_chitiet",
    label: "Chi tiết quy trình sơn",
    icon: null,
    fields: [
      {
        name: "id_chitiet",
        type: "number",
        label: "ID chi tiết",
      },
      {
        name: "id_quytrinh",
        type: "number",
        label: "ID quy trình",
      },
      {
        name: "mact",
        type: "text",
        label: "Mã chi tiết",
      },
      {
        name: "tyle",
        type: "number",
        label: "Tỷ lệ",
      },
      {
        name: "donhot",
        type: "text",
        label: "Độ nhớt",
      },
      {
        name: "phuongphap",
        type: "text",
        label: "Phương pháp",
      },
      {
        name: "dinhluong",
        type: "number",
        label: "Định lượng",
      },
      {
        name: "dinhluong_real",
        type: "number",
        label: "Định lượng thực",
      },
      {
        name: "thoigiankho",
        type: "text",
        label: "Thời gian khô",
      },
      {
        name: "haohut",
        type: "number",
        label: "Hao hụt",
      },
      {
        name: "phantram",
        type: "number",
        label: "Phần trăm",
      },
      {
        name: "is_active",
        type: "boolean",
        label: "Hoạt động",
      },
      {
        name: "nguoitao",
        type: "text",
        label: "Người tạo",
      },
      {
        name: "ngaytao",
        type: "datetime",
        label: "Ngày tạo",
      },
      {
        name: "nguoisua",
        type: "text",
        label: "Người sửa",
      },
      {
        name: "ngaysua",
        type: "datetime",
        label: "Ngày sửa",
      },
      {
        ref: "c8103d79-9a40-4cb2-9854-f12f7da11d1b",
        name: "quytrinh_ref",
        type: "relation",
        label: "Quy trình",
        filterable: true,
      },
    ],
    meta: {
      sync: {
        state: "live",
      },
      storage: {
        tier: "table",
        columns: {
          mact: {
            col: "f_mact",
            pgType: "text",
          },
          tyle: {
            col: "f_tyle",
            pgType: "numeric",
          },
          donhot: {
            col: "f_donhot",
            pgType: "text",
          },
          haohut: {
            col: "f_haohut",
            pgType: "numeric",
          },
          ngaysua: {
            col: "f_ngaysua",
            pgType: "text",
          },
          ngaytao: {
            col: "f_ngaytao",
            pgType: "text",
          },
          nguoisua: {
            col: "f_nguoisua",
            pgType: "text",
          },
          nguoitao: {
            col: "f_nguoitao",
            pgType: "text",
          },
          phantram: {
            col: "f_phantram",
            pgType: "numeric",
          },
          dinhluong: {
            col: "f_dinhluong",
            pgType: "numeric",
          },
          is_active: {
            col: "f_is_active",
            pgType: "boolean",
          },
          id_chitiet: {
            col: "f_id_chitiet",
            pgType: "numeric",
          },
          phuongphap: {
            col: "f_phuongphap",
            pgType: "text",
          },
          id_quytrinh: {
            col: "f_id_quytrinh",
            pgType: "numeric",
          },
          thoigiankho: {
            col: "f_thoigiankho",
            pgType: "text",
          },
          quytrinh_ref: {
            col: "f_quytrinh_ref",
            pgType: "text",
          },
          dinhluong_real: {
            col: "f_dinhluong_real",
            pgType: "numeric",
          },
        },
        version: 2,
        tableName: "tr_quytrinh_son_chitiet",
        searchable: [],
      },
    },
  },
] as const;

const DATASOURCE = {
  id: "d5000001-0000-4000-8000-000000000001",
  name: "ds_quytrinh_son_chitiet_join",
  label: "Chi tiết quy trình sơn (join)",
  icon: null,
  config: {
    fields: [
      {
        key: "stt",
        type: "number",
        label: "STT",
        sourceField: "stt",
        sourceRelationId: "rA",
      },
      {
        key: "tenbuocson",
        type: "text",
        label: "Bước sơn",
        sourceField: "tenbuocson",
        sourceRelationId: "rA",
      },
      {
        key: "mact",
        type: "text",
        label: "Mã chi tiết",
        sourceField: "mact",
        sourceRelationId: "base",
      },
      {
        key: "mota",
        type: "text",
        label: "Mô tả vật tư",
        sourceField: "mota",
        sourceRelationId: "rC",
      },
      {
        key: "tyle",
        type: "number",
        label: "Tỷ lệ",
        sourceField: "tyle",
        sourceRelationId: "base",
      },
      {
        key: "donhot",
        type: "text",
        label: "Độ nhớt",
        sourceField: "donhot",
        sourceRelationId: "rA",
      },
      {
        key: "phuongphap",
        type: "text",
        label: "Phương pháp",
        sourceField: "phuongphap",
        sourceRelationId: "rA",
      },
      {
        key: "tongsoluong",
        type: "number",
        label: "Tổng số lượng",
        sourceField: "tongsoluong",
        sourceRelationId: "rA",
      },
      {
        key: "dinhluong",
        type: "number",
        label: "Định lượng",
        sourceField: "dinhluong",
        sourceRelationId: "base",
      },
      {
        key: "thoigiankho",
        type: "text",
        label: "Thời gian khô",
        sourceField: "thoigiankho",
        sourceRelationId: "rA",
      },
      {
        key: "dongia",
        type: "currency",
        label: "Đơn giá",
        sourceField: "dongia",
        sourceRelationId: "rC",
      },
      {
        key: "quytrinh_ref",
        type: "text",
        label: "quytrinh_ref",
        sourceField: "quytrinh_ref",
        sourceRelationId: "base",
      },
      {
        key: "color_ref",
        type: "text",
        label: "color_ref",
        sourceField: "color_ref",
        sourceRelationId: "rA",
      },
    ],
    computed: [
      {
        key: "thanhtien",
        expr: "{dongia} * {dinhluong}",
        type: "number",
        label: "Thành tiền",
      },
    ],
    relations: [
      {
        id: "rA",
        alias: "rA",
        toField: "id_quytrinh",
        joinKind: "left",
        fromField: "id_quytrinh",
        fromRelationId: null,
        targetEntityId: "c8103d79-9a40-4cb2-9854-f12f7da11d1b",
      },
      {
        id: "rC",
        alias: "rC",
        toField: "mavt",
        joinKind: "left",
        fromField: "mact",
        fromRelationId: null,
        targetEntityId: "b84aebbd-3f2f-4735-8409-202b679a8044",
      },
    ],
    baseEntityId: "4d52f2b2-0098-494f-add1-2f33ba47e082",
  },
} as const;

function tbl(name: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error("table không an toàn: " + name);
  return sql.raw('"' + name + '"');
}

export async function setupQuytrinhSonProd(
  db: DB,
  companyId: string,
  _args: Record<string, unknown>,
): Promise<Array<{ ok: boolean; entities: number; datasource: number; message: string }>> {
  // 1) Bổ sung cột lookup dev-only (an toàn, null) để Sửa/Áp dụng quy trình ghi được.
  await db.execute(sql`ALTER TABLE tr_quytrinh_son ADD COLUMN IF NOT EXISTS f_color_ref text`);
  await db.execute(
    sql`ALTER TABLE tr_quytrinh_son_chitiet ADD COLUMN IF NOT EXISTS f_quytrinh_ref text`,
  );

  // 2) Đăng ký entity (full meta dev) — upsert theo id.
  for (const e of ENTITIES) {
    await db.execute(sql`
      INSERT INTO entities (id, company_id, name, label, icon, fields, meta, created_at, updated_at)
      VALUES (${e.id}::uuid, ${companyId}::uuid, ${e.name}, ${e.label}, ${e.icon ?? null},
              ${JSON.stringify(e.fields)}::jsonb, ${JSON.stringify(e.meta)}::jsonb, now(), now())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, label = EXCLUDED.label,
        icon = EXCLUDED.icon, fields = EXCLUDED.fields, meta = EXCLUDED.meta, updated_at = now()
    `);
  }

  // 3) Đăng ký datasource — upsert theo id.
  await db.execute(sql`
    INSERT INTO datasources (id, company_id, name, label, icon, config, created_at, updated_at)
    VALUES (${DATASOURCE.id}::uuid, ${companyId}::uuid, ${DATASOURCE.name}, ${DATASOURCE.label},
            ${DATASOURCE.icon ?? null}, ${JSON.stringify(DATASOURCE.config)}::jsonb, now(), now())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, label = EXCLUDED.label,
      icon = EXCLUDED.icon, config = EXCLUDED.config, updated_at = now()
  `);

  // 4) record_locator cho các dòng dữ liệu sẵn có (để sửa-theo-id resolve đúng bảng).
  for (const e of ENTITIES) {
    const t = tbl((e.meta as { storage: { tableName: string } }).storage.tableName);
    await db.execute(sql`
      INSERT INTO record_locator (id, company_id, entity_id)
      SELECT id, company_id, ${e.id}::uuid FROM ${t} WHERE company_id = ${companyId}::uuid
      ON CONFLICT (id) DO NOTHING
    `);
  }

  return [
    {
      ok: true,
      entities: ENTITIES.length,
      datasource: 1,
      message: `Đã đăng ký ${ENTITIES.length} entity + 1 datasource cho trang Định mức màu sơn.`,
    },
  ];
}
