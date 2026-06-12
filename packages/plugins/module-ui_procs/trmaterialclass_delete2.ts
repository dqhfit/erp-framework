/* Port TRMATERIALCLASS_DELETE2 — xoá 1 nút phân loại vật tư + TOÀN BỘ
   con cháu trong cây (p_id trỏ code cha).
   Nguồn: migration-plan/ui/proc-bodies/trmaterialclass_delete2.sql
   Proc gốc dùng CTE đệ quy "rcte" gom node con cháu rồi UPDATE active = 0
   (đã là soft-delete kiểu cũ; nhánh DELETE thật bị comment sẵn trong nguồn).
   Hệ mới: dịch đệ quy sang JS — đọc toàn bộ trmaterialclass của company qua
   listWhere, dựng map cha-con theo code/p_id, BFS gom id con cháu (kèm guard
   vòng lặp), rồi softDeleteWhere theo danh sách id (deleted_at — chuẩn
   soft-delete của framework, thay cho active = 0). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trmaterialclassDelete2(
  db: DB,
  companyId: string,
  args: {
    key: string; // @Key — code của nút gốc cần xoá
  },
): Promise<number> {
  if (!args.key) throw new Error("Thiếu key");

  const t = await procTable(db, companyId, "trmaterialclass");

  // Đọc toàn bộ cây phân loại của company (chỉ cần id/code/p_id)
  const all = await t.listWhere(sql`TRUE`);

  // Map code cha → danh sách node con (p_id = code cha)
  const childrenByParent = new Map<string, Array<Record<string, unknown>>>();
  for (const row of all) {
    const pid = row.p_id == null ? null : String(row.p_id);
    if (pid == null || pid === "") continue;
    const list = childrenByParent.get(pid);
    if (list) list.push(row);
    else childrenByParent.set(pid, [row]);
  }

  // BFS từ các node code = key (CTE gốc seed WHERE code = @Key) — gom id
  // node + toàn bộ con cháu. visited theo id chống vòng (CTE gốc
  // MAXRECURSION 0 sẽ treo nếu data có vòng — JS guard luôn cho chắc).
  const ids: number[] = [];
  const visited = new Set<string>();
  const queue: Array<Record<string, unknown>> = all.filter(
    (row) => String(row.code ?? "") === args.key,
  );
  while (queue.length > 0) {
    const row = queue.shift();
    if (!row) break;
    const idKey = String(row._id);
    if (visited.has(idKey)) continue;
    visited.add(idKey);
    const idNum = Number(row.id);
    if (Number.isFinite(idNum)) ids.push(idNum);
    const code = row.code == null ? null : String(row.code);
    if (code) {
      for (const child of childrenByParent.get(code) ?? []) queue.push(child);
    }
  }

  if (ids.length === 0) return 0;

  // Proc gốc: UPDATE trmaterialclass SET active = 0 WHERE id IN (#TEMP) —
  // GIỮ NGUYÊN semantics (active=false), KHÔNG deleted_at: legacy dùng cờ
  // active để ẩn/hiện, record vẫn phải đọc được (vd khôi phục, báo cáo).
  return t.updateWhere(
    { active: false },
    sql`${t.num("id")} IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
}
