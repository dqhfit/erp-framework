/* ==========================================================
   resource-acl.ts — Generic per-resource membership layer.
   ────────────────────────────────────────────────────────────
   Thay thế pattern "1 bảng pivot mỗi resource type" (agent_members,
   page_members tương lai, …) bằng 1 bảng resource_members chung.
   File này CHỈ là DB-layer (CRUD membership) — KHÔNG chứa policy
   (vd "private → cần member", "owner-only delete"). Policy thuộc về
   mỗi resource type (agent-acl.ts, page-acl.ts khi có) — gọi xuống
   các helper ở đây để query role.

   Resource type whitelist:
   - "agent"  : đã backfill từ agent_members (migration 0044)
   - "page"   : để dành (Sprint mở rộng share Pages tương lai)
   - "record" : để dành (per-row ACL trên entity_records tương lai)

   Role là chuỗi tự do theo từng resource type — caller phải tự
   validate (vd agent: owner|operator|observer).
   ========================================================== */

import { resourceMembers } from "@erp-framework/db";
import { and, eq } from "drizzle-orm";
import type { DB } from "./db";

export type ResourceType = "agent" | "page" | "record";

export interface ResourceMember {
  userId: string;
  role: string;
  addedBy: string;
  addedAt: Date;
}

/** Tra role của user trong 1 resource cụ thể. null nếu chưa add. */
export async function getResourceRole(
  db: DB,
  resourceType: ResourceType,
  resourceId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ role: resourceMembers.role })
    .from(resourceMembers)
    .where(
      and(
        eq(resourceMembers.resourceType, resourceType),
        eq(resourceMembers.resourceId, resourceId),
        eq(resourceMembers.userId, userId),
      ),
    );
  return row?.role ?? null;
}

/** Liệt kê toàn bộ member của 1 resource. */
export async function listResourceMembers(
  db: DB,
  resourceType: ResourceType,
  resourceId: string,
): Promise<ResourceMember[]> {
  const rows = await db
    .select({
      userId: resourceMembers.userId,
      role: resourceMembers.role,
      addedBy: resourceMembers.addedBy,
      addedAt: resourceMembers.addedAt,
    })
    .from(resourceMembers)
    .where(
      and(
        eq(resourceMembers.resourceType, resourceType),
        eq(resourceMembers.resourceId, resourceId),
      ),
    );
  return rows;
}

/** Upsert membership (thêm mới hoặc đổi role). */
export async function upsertResourceMember(
  db: DB,
  resourceType: ResourceType,
  resourceId: string,
  userId: string,
  role: string,
  addedBy: string,
): Promise<void> {
  await db
    .insert(resourceMembers)
    .values({ resourceType, resourceId, userId, role, addedBy })
    .onConflictDoUpdate({
      target: [resourceMembers.resourceType, resourceMembers.resourceId, resourceMembers.userId],
      set: { role, addedBy, addedAt: new Date() },
    });
}

/** Gỡ 1 member khỏi resource. Idempotent. */
export async function removeResourceMember(
  db: DB,
  resourceType: ResourceType,
  resourceId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(resourceMembers)
    .where(
      and(
        eq(resourceMembers.resourceType, resourceType),
        eq(resourceMembers.resourceId, resourceId),
        eq(resourceMembers.userId, userId),
      ),
    );
}

/** Xoá toàn bộ member khi resource bị xoá. Caller nên gọi trong cùng
 *  transaction với delete resource để giữ consistency. */
export async function clearResourceMembers(
  db: DB,
  resourceType: ResourceType,
  resourceId: string,
): Promise<void> {
  await db
    .delete(resourceMembers)
    .where(
      and(
        eq(resourceMembers.resourceType, resourceType),
        eq(resourceMembers.resourceId, resourceId),
      ),
    );
}
