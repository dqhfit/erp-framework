/* ==========================================================
   knowledge-acl.ts — Phân quyền truy cập nguồn tri thức theo user/nhóm.

   Mô hình visibility (migration 0068 + 0085):
   - "private": chỉ người tạo (created_by) và admin.
   - "restricted": chỉ admin + người tạo + user/nhóm được cấp riêng.
   - "company" (mặc định): mọi user có quyền RBAC view:knowledge trong công ty.
   - "public": ai cũng truy cập được (qua share_token, không cần login).
     Luôn accessible — knowledgeAccessibleSql trả true cho public.

   Hàm lõi `knowledgeAccessibleSql` trả 1 biểu thức boolean SQL referencing
   bảng knowledge_sources — dùng chung cho subquery trong knowledge-search
   lẫn .where() ở sources.list/get (đều query thẳng bảng, không alias).
   ========================================================== */
import type { Role } from "@erp-framework/core";
import { userViewerGroups } from "@erp-framework/db";
import { eq, type SQL, sql } from "drizzle-orm";
import type { DB } from "./db";

export interface KnowledgeAcl {
  userId: string;
  /** Id các nhóm người xem mà user thuộc về (dựng từ user_viewer_groups). */
  groupIds: string[];
}

/** Danh sách nhóm người xem của 1 user. */
export async function userGroupIds(db: DB, userId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: userViewerGroups.groupId })
    .from(userViewerGroups)
    .where(eq(userViewerGroups.userId, userId));
  return rows.map((r) => r.groupId);
}

/** Dựng ACL principal cho user. Admin xem mọi nguồn → trả null để caller
 *  BỎ QUA lọc (tránh subquery thừa). User thường → trả {userId, groupIds}. */
export async function resolveKnowledgeAcl(
  db: DB,
  role: Role,
  userId: string,
): Promise<KnowledgeAcl | null> {
  if (role === "admin") return null;
  return { userId, groupIds: await userGroupIds(db, userId) };
}

/** Biểu thức SQL: "row knowledge_sources này user truy cập được?".
 *  CHỈ hợp lệ khi knowledge_sources là bảng đang query (không alias).
 *  "public" luôn accessible (share link); "company" accessible với mọi
 *  user trong công ty; "restricted"/"private" kiểm tra created_by + members. */
export function knowledgeAccessibleSql(acl: KnowledgeAcl): SQL {
  const groupClause =
    acl.groupIds.length > 0
      ? sql` OR EXISTS (SELECT 1 FROM knowledge_source_viewer_groups kg
            WHERE kg.source_id = knowledge_sources.id
              AND kg.group_id IN (${sql.join(
                acl.groupIds.map((g) => sql`${g}::uuid`),
                sql`, `,
              )}))`
      : sql``;
  return sql`(
    knowledge_sources.visibility = 'public'
    OR knowledge_sources.visibility = 'company'
    OR knowledge_sources.created_by = ${acl.userId}::uuid
    OR EXISTS (SELECT 1 FROM resource_members rm
        WHERE rm.resource_type = 'knowledge'
          AND rm.resource_id = knowledge_sources.id
          AND rm.user_id = ${acl.userId}::uuid)${groupClause}
  )`;
}
