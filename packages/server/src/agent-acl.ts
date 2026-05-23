/* ==========================================================
   agent-acl.ts — Phân quyền per-agent (hybrid model).
   ────────────────────────────────────────────────────────────
   Mô hình:
   - agents.config.isPrivate: boolean (mặc định false = open).
   - agent_members(agent_id, user_id, role): pivot N:M user × agent.
     role = owner | operator | observer.
   Quy ước hành vi:
     isPrivate=false → fallback về company-RBAC cũ (mọi editor edit OK).
                        agent_members chỉ dùng tag UI "my agents".
     isPrivate=true  → ACL chặt theo agent_members.role:
       owner    : view + chat + edit + delete + manage_members + toggle private
       operator : view + chat + edit
       observer : view + chat (read-only)
       (không phải member) → 403
   - Admin company: bỏ qua hết (super-bypass).
   - Action "manage_members" và "delete" + toggle `isPrivate` LUÔN cần
     owner-role hoặc admin, kể cả khi isPrivate=false (xem `OWNER_ONLY`).
   ========================================================== */
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { agents, agentMembers, type agentMemberRole } from "@erp-framework/db";
import { roleCan } from "@erp-framework/core";
import type { Context } from "./context";
import { protectedProcedure } from "./trpc";

export type AgentAction = "view" | "chat" | "edit" | "delete" | "manage_members";
export type MemberRole = (typeof agentMemberRole.enumValues)[number]; // "owner"|"operator"|"observer"

/* Action chỉ owner (hoặc admin) mới làm được — kể cả ở open mode. */
const OWNER_ONLY: AgentAction[] = ["delete", "manage_members"];

interface AgentRow {
  id: string;
  companyId: string;
  config: unknown;
}

/** Bảng quyền per-role trong private mode. */
const PRIVATE_MATRIX: Record<MemberRole, AgentAction[]> = {
  owner:    ["view", "chat", "edit", "delete", "manage_members"],
  operator: ["view", "chat", "edit"],
  observer: ["view", "chat"],
};

/** Tra `agent_members.role` cho cặp (agentId, userId). Trả null nếu chưa add. */
export async function getMemberRole(
  ctx: Context, agentId: string, userId: string,
): Promise<MemberRole | null> {
  const [row] = await ctx.db.select({ role: agentMembers.role })
    .from(agentMembers)
    .where(and(eq(agentMembers.agentId, agentId), eq(agentMembers.userId, userId)));
  return (row?.role as MemberRole | undefined) ?? null;
}

/** Load agent + companyId guard. Ném NOT_FOUND nếu agent không thuộc công ty. */
export async function loadAgentInCompany(
  ctx: Context, agentId: string,
): Promise<AgentRow> {
  if (!ctx.user?.companyId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Chưa thuộc công ty nào" });
  }
  const [row] = await ctx.db.select({
    id: agents.id, companyId: agents.companyId, config: agents.config,
  }).from(agents).where(and(
    eq(agents.id, agentId),
    eq(agents.companyId, ctx.user.companyId),
  ));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Agent không tồn tại" });
  return row;
}

/**
 * Phiên bản "lite" không cần Context — dùng được trong route HTTP ngoài tRPC
 * (vd /agent/chat). Tham số thuần: db + (userId, role, companyId) + (agentId, action).
 */
export async function canActOnAgentLite(
  db: Context["db"],
  user: { id: string; role: string; companyId: string },
  agentId: string,
  action: AgentAction,
): Promise<boolean> {
  if (user.role === "admin") return true;

  const [agent] = await db.select({
    id: agents.id, companyId: agents.companyId, config: agents.config,
  }).from(agents).where(and(
    eq(agents.id, agentId),
    eq(agents.companyId, user.companyId),
  ));
  if (!agent) return false;

  const cfg = (agent.config ?? {}) as { isPrivate?: boolean };
  const isPrivate = cfg.isPrivate === true;

  const [m] = await db.select({ role: agentMembers.role })
    .from(agentMembers)
    .where(and(eq(agentMembers.agentId, agentId), eq(agentMembers.userId, user.id)));
  const memberRole = (m?.role as MemberRole | undefined) ?? null;

  if (OWNER_ONLY.includes(action)) return memberRole === "owner";
  if (isPrivate) {
    if (!memberRole) return false;
    return PRIVATE_MATRIX[memberRole].includes(action);
  }
  const rbacAction = action === "chat" ? "run" : action;
  return roleCan(user.role as "admin"|"editor"|"viewer",
    rbacAction as "view"|"edit"|"run", "agent");
}

/**
 * Kiểm quyền per-agent — return boolean, không ném.
 * Caller tự ném FORBIDDEN khi cần (xem `agentProcedure`).
 */
export async function canActOnAgent(
  ctx: Context, agentId: string, action: AgentAction,
): Promise<boolean> {
  if (!ctx.user?.companyId) return false;
  return canActOnAgentLite(ctx.db, {
    id: ctx.user.id, role: ctx.user.role, companyId: ctx.user.companyId,
  }, agentId, action);
}

/** Throw FORBIDDEN nếu user không có quyền hành động. */
export async function assertCanActOnAgent(
  ctx: Context, agentId: string, action: AgentAction,
): Promise<void> {
  if (!await canActOnAgent(ctx, agentId, action)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Không có quyền ${action} trên agent này`,
    });
  }
}

/* Procedure wrapper cho tRPC. Đoán agentId từ input (string UUID hoặc
   object có { id }/{ agentId }). Dùng cho agents.get/save(update)/
   delete + member CRUD. */
export function agentProcedure(action: AgentAction) {
  return protectedProcedure.use(async ({ ctx, input, next }) => {
    const id = typeof input === "string"
      ? input
      : (input as { id?: string; agentId?: string })?.id
        ?? (input as { agentId?: string })?.agentId;
    if (!id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Thiếu agentId" });
    }
    await assertCanActOnAgent(ctx, id, action);
    return next();
  });
}
