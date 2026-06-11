import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trKhachhangInsert3(
  db: DB,
  companyId: string,
  args: {
    customer_id: string;
    customer_name: string;
    address?: string | null;
    area?: string | null;
    phone?: string | null;
    fax?: string | null;
    email?: string | null;
    website?: string | null;
    director?: string | null;
    merchandiser?: string | null;
    merchandiser_phone?: string | null;
    merchandiser_mail?: string | null;
    ngaylamviec?: string | null;
    create_by?: string | null;
    create_date?: string | null;
    bank_id?: string | null;
    taxcode?: string | null;
    active?: boolean | null;
    customer_type?: string | null;
    customer_type_name?: string | null;
  },
): Promise<Array<{ id: number }>> {
  if (!args.customer_id) throw new Error("Thiếu customer_id");
  if (!args.customer_name) throw new Error("Thiếu customer_name");

  // Kiểm tra khách hàng đã tồn tại theo customer_id (trong phạm vi company)
  const existing = await db.execute<{ id: number }>(sql`
    SELECT id
    FROM tr_khachhang
    WHERE company_id = ${companyId}
      AND customer_id = ${args.customer_id}
      AND deleted_at IS NULL
    LIMIT 1
  `);

  const rows = existing as unknown as Array<{ id: number }>;

  if (rows.length > 0) {
    // Đã tồn tại — trả lại id hiện có (tương đương nhánh ELSE của proc gốc)
    return [{ id: rows[0].id }];
  }

  // Chưa tồn tại — INSERT và trả id mới (tương đương SCOPE_IDENTITY())
  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO tr_khachhang (
      company_id,
      customer_id,
      customer_name,
      address,
      area,
      phone,
      fax,
      email,
      website,
      director,
      merchandiser,
      merchandiser_phone,
      merchandiser_mail,
      ngaylamviec,
      create_by,
      create_date,
      bank_id,
      taxcode,
      active,
      customer_type,
      customer_type_name,
      created_at,
      updated_at
    )
    VALUES (
      ${companyId},
      ${args.customer_id},
      ${args.customer_name},
      ${args.address ?? null},
      ${args.area ?? null},
      ${args.phone ?? null},
      ${args.fax ?? null},
      ${args.email ?? null},
      ${args.website ?? null},
      ${args.director ?? null},
      ${args.merchandiser ?? null},
      ${args.merchandiser_phone ?? null},
      ${args.merchandiser_mail ?? null},
      ${args.ngaylamviec ?? null},
      ${args.create_by ?? null},
      ${args.create_date ?? null},
      ${args.bank_id ?? null},
      ${args.taxcode ?? null},
      ${args.active ?? null},
      ${args.customer_type ?? null},
      ${args.customer_type_name ?? null},
      now(),
      now()
    )
    RETURNING id
  `);

  return inserted as unknown as Array<{ id: number }>;
}
