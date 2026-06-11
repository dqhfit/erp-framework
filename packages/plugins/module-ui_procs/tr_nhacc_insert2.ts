import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trNhaccInsert2(
  db: DB,
  companyId: string,
  args: {
    vendor_id: string;
    vendor_name: string;
    address: string;
    area?: string;
    phone: string;
    email: string;
    website: string;
    loaincc: number;
    create_by: string;
    create_date: Date | string;
    sotaikhoan?: string | null;
    tentaikhoan?: string | null;
    tennganhang?: string | null;
  },
): Promise<Array<{ id: number }>> {
  if (!args.vendor_id) throw new Error("Thiếu vendor_id");
  if (!args.vendor_name) throw new Error("Thiếu vendor_name");
  if (!args.create_by) throw new Error("Thiếu create_by");

  const r = await db.execute<{ id: number }>(sql`
    INSERT INTO tr_nhacc
      (company_id, vendor_id, vendor_name, address, area, phone, email,
       website, loaincc, create_by, create_date,
       sotaikhoan, tentaikhoan, tennganhang,
       created_at, updated_at)
    VALUES
      (${companyId}, ${args.vendor_id}, ${args.vendor_name}, ${args.address},
       ${args.area ?? ""}, ${args.phone}, ${args.email},
       ${args.website}, ${args.loaincc}, ${args.create_by}, ${args.create_date},
       ${args.sotaikhoan ?? null}, ${args.tentaikhoan ?? null}, ${args.tennganhang ?? null},
       now(), now())
    RETURNING id
  `);

  return r as unknown as Array<{ id: number }>;
}
