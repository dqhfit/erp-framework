/* ==========================================================
   feedback-proposals.ts — Lõi dùng chung cho đề xuất AI (ai_proposals).

   Hai bên dùng:
   - mcp-feedback.ts: AI tạo proposal pending (validate actions bằng
     ZProposalAction). AI KHÔNG được mutate trực tiếp.
   - feedback-router.ts: admin duyệt → applyProposalActions() thực thi
     trong 1 transaction (đổi status / đánh dấu trùng / thêm lộ trình).

   Mỗi proposal mang 1 mảng `actions` (ProposalAction[]). Ba loại:
   - set_status     : đổi trạng thái 1 nhóm feedback (vd cùng đánh dấu
                      in_progress sau khi gộp).
   - mark_duplicate : đánh dấu các feedback trùng với 1 mục gốc → set
                      trạng thái chung + ghi note "Trùng với <gốc>".
   - add_to_roadmap : tạo (hoặc gắn vào) 1 mục lộ trình/task-fix, link
                      các feedback, tùy chọn đổi status nguồn.
   ========================================================== */
import { aiProposals, feedbacks, roadmapItems } from "@erp-framework/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db";

export const FEEDBACK_STATUSES = ["new", "in_progress", "done", "wontfix"] as const;
const ZStatus = z.enum(FEEDBACK_STATUSES);
const ZPriority = z.enum(["low", "normal", "high"]);

const ZSetStatus = z.object({
  type: z.literal("set_status"),
  feedbackIds: z.array(z.string().uuid()).min(1).max(200),
  status: ZStatus,
  resolutionNote: z.string().max(2000).optional(),
});

const ZMarkDuplicate = z.object({
  type: z.literal("mark_duplicate"),
  primaryId: z.string().uuid(),
  duplicateIds: z.array(z.string().uuid()).min(1).max(200),
  // Trạng thái chung gán cho các mục trùng (mặc định wontfix).
  status: ZStatus.optional(),
  resolutionNote: z.string().max(2000).optional(),
});

const ZAddToRoadmap = z
  .object({
    type: z.literal("add_to_roadmap"),
    feedbackIds: z.array(z.string().uuid()).max(200).optional().default([]),
    // Gắn vào lộ trình có sẵn …
    roadmapId: z.string().uuid().optional(),
    // … hoặc tạo mới.
    roadmap: z
      .object({
        title: z.string().min(3).max(200),
        description: z.string().max(10_000).optional(),
        area: z.string().max(40).optional(),
        priority: ZPriority.optional(),
        targetQuarter: z.string().max(20).optional(),
      })
      .optional(),
    // Tùy chọn: đổi status các feedback nguồn (vd in_progress).
    setStatus: ZStatus.optional(),
  })
  .refine((a) => !!a.roadmapId || !!a.roadmap, {
    message: "add_to_roadmap cần roadmapId (gắn cũ) hoặc roadmap (tạo mới)",
  });

export const ZProposalAction = z.discriminatedUnion("type", [
  ZSetStatus,
  ZMarkDuplicate,
  ZAddToRoadmap,
]);
export type ProposalAction = z.infer<typeof ZProposalAction>;

export const ZProposalActions = z.array(ZProposalAction).min(1).max(50);

/** Mục cần notify author sau khi apply (router lo việc gửi). */
export interface NotifyTarget {
  feedbackId: string;
  title: string;
  authorUserId: string;
  status: string;
}

export interface ApplyResult {
  statusUpdated: number;
  duplicatesMarked: number;
  roadmapCreated: { id: string; title: string }[];
  roadmapLinked: { id: string; added: number }[];
  notify: NotifyTarget[];
}

type TxLike = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Đổi status 1 nhóm feedback (scope companyId, bỏ mục đã xoá). Trả các
 *  mục THỰC SỰ đổi để notify — bỏ mục đã đúng status. */
async function setStatusGroup(
  tx: TxLike,
  companyId: string,
  ids: string[],
  status: (typeof FEEDBACK_STATUSES)[number],
  resolutionNote: string | undefined,
  notify: NotifyTarget[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx
    .select({
      id: feedbacks.id,
      title: feedbacks.title,
      authorUserId: feedbacks.authorUserId,
      status: feedbacks.status,
    })
    .from(feedbacks)
    .where(
      and(
        eq(feedbacks.companyId, companyId),
        inArray(feedbacks.id, ids),
        isNull(feedbacks.deletedAt),
      ),
    );
  const toUpdate = rows.filter((r) => r.status !== status);
  if (toUpdate.length === 0) return 0;
  const updIds = toUpdate.map((r) => r.id);
  const patch: { status: typeof status; updatedAt: Date; resolutionNote?: string } = {
    status,
    updatedAt: new Date(),
  };
  if (resolutionNote !== undefined) patch.resolutionNote = resolutionNote;
  await tx
    .update(feedbacks)
    .set(patch)
    .where(and(eq(feedbacks.companyId, companyId), inArray(feedbacks.id, updIds)));
  for (const r of toUpdate) {
    notify.push({ feedbackId: r.id, title: r.title, authorUserId: r.authorUserId, status });
  }
  return updIds.length;
}

/**
 * Thực thi danh sách hành động của 1 proposal trong 1 transaction.
 * Mọi truy vấn scope theo companyId (chống chéo tenant). Idempotent ở
 * mức "đã đúng status thì bỏ qua". Trả ApplyResult để router notify +
 * lưu apply_result.
 */
export async function applyProposalActions(
  db: DB,
  opts: { companyId: string; actorUserId: string; actions: ProposalAction[] },
): Promise<ApplyResult> {
  const { companyId, actorUserId, actions } = opts;
  // Validate lại — phòng dữ liệu cũ/hỏng trong cột jsonb.
  const parsed = ZProposalActions.parse(actions);

  const result: ApplyResult = {
    statusUpdated: 0,
    duplicatesMarked: 0,
    roadmapCreated: [],
    roadmapLinked: [],
    notify: [],
  };

  await db.transaction(async (tx) => {
    for (const action of parsed) {
      if (action.type === "set_status") {
        result.statusUpdated += await setStatusGroup(
          tx,
          companyId,
          action.feedbackIds,
          action.status,
          action.resolutionNote,
          result.notify,
        );
      } else if (action.type === "mark_duplicate") {
        const status = action.status ?? "wontfix";
        const note = action.resolutionNote ?? `Trùng với phản hồi ${action.primaryId}`;
        // Không tự đánh dấu mục gốc là trùng chính nó.
        const dupIds = action.duplicateIds.filter((id) => id !== action.primaryId);
        result.duplicatesMarked += await setStatusGroup(
          tx,
          companyId,
          dupIds,
          status,
          note,
          result.notify,
        );
      } else {
        // add_to_roadmap
        let roadmapId = action.roadmapId ?? null;
        const feedbackIds = action.feedbackIds ?? [];

        if (roadmapId) {
          // Gắn feedback vào lộ trình có sẵn — merge feedback_ids (dedup).
          const [existing] = await tx
            .select({ id: roadmapItems.id, feedbackIds: roadmapItems.feedbackIds })
            .from(roadmapItems)
            .where(and(eq(roadmapItems.id, roadmapId), eq(roadmapItems.companyId, companyId)));
          if (!existing) {
            throw new Error(`Lộ trình ${roadmapId} không tồn tại trong công ty`);
          }
          const cur = Array.isArray(existing.feedbackIds) ? (existing.feedbackIds as string[]) : [];
          const merged = [...new Set([...cur, ...feedbackIds])];
          await tx
            .update(roadmapItems)
            .set({ feedbackIds: merged, updatedAt: new Date() })
            .where(eq(roadmapItems.id, roadmapId));
          result.roadmapLinked.push({ id: roadmapId, added: merged.length - cur.length });
        } else if (action.roadmap) {
          const [row] = await tx
            .insert(roadmapItems)
            .values({
              companyId,
              title: action.roadmap.title.trim(),
              description: action.roadmap.description ?? null,
              area: action.roadmap.area ?? null,
              priority: action.roadmap.priority ?? "normal",
              targetQuarter: action.roadmap.targetQuarter ?? null,
              feedbackIds: [...new Set(feedbackIds)],
              source: "ai_proposal",
              createdBy: actorUserId,
            })
            .returning({ id: roadmapItems.id, title: roadmapItems.title });
          if (row) {
            roadmapId = row.id;
            result.roadmapCreated.push({ id: row.id, title: row.title });
          }
        }

        if (action.setStatus && feedbackIds.length > 0) {
          result.statusUpdated += await setStatusGroup(
            tx,
            companyId,
            feedbackIds,
            action.setStatus,
            undefined,
            result.notify,
          );
        }
      }
    }
  });

  return result;
}

/** Đảm bảo proposal thuộc công ty + đang ở trạng thái cho phép thao tác. */
export async function loadProposalForReview(
  db: DB,
  companyId: string,
  id: string,
): Promise<typeof aiProposals.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.id, id), eq(aiProposals.companyId, companyId)));
  return row ?? null;
}
