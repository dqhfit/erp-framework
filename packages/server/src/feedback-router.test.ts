/* ==========================================================
   feedback-router.test.ts — Unit test cho feedback router.
   Focus: list/get/create/setStatus/vote/comments/findSimilar +
   RBAC matrix + validation.
   ========================================================== */
import { describe, it, expect, vi } from "vitest";
import { buildMergeMarkdown, feedbackRouter } from "./feedback-router";
import { createCallerFactory } from "./trpc";
import { makeMockCtx, makeMockDb, makeMockUser, assertThrowsTRPCError } from "./test-helpers";

const caller = createCallerFactory(feedbackRouter);
const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";

// Mock fire-and-forget side effects: notify, AI enqueue, log.
vi.mock("./notifications-router", () => ({
  notifyAdmins: vi.fn().mockResolvedValue(undefined),
  notifyMentions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./activity", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./feedback-ai", () => ({
  enqueueFeedbackAi: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./embeddings", () => ({
  embedTexts: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]), // mock vector
}));
vi.mock("./llm-json", () => ({
  callLlmJson: vi.fn().mockResolvedValue(null),
}));

describe("feedback-router", () => {
  describe("list", () => {
    it("trả danh sách feedback của company", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID,
          title: "Bug A",
          area: "ui",
          severity: "normal",
          status: "new",
          voteCount: 2,
          aiSummary: null,
          aiTags: null,
          authorUserId: "user_test_1",
          createdAt: new Date(),
        },
      ]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).list();
      expect(r).toHaveLength(1);
      expect(r[0]?.title).toBe("Bug A");
    });

    it("RBAC: viewer xem được (view:activity)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db, user: makeMockUser({ role: "viewer" }) });
      const r = await caller(ctx).list();
      expect(r).toEqual([]);
    });

    it("RBAC: user chưa thuộc company → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ companyId: null }) });
      await assertThrowsTRPCError(() => caller(ctx).list(), "FORBIDDEN");
    });

    it("filter status + area được parse đúng (không throw)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await caller(ctx).list({ status: "new", area: "ui", mine: true });
    });
  });

  describe("get", () => {
    it("trả detail + myVote=true khi user đã vote", async () => {
      const { db, enqueueSelect } = makeMockDb();
      const row = {
        id: VALID_UUID,
        companyId: "co_test_1",
        title: "X",
        body: "Y",
        area: "ui",
        severity: "normal",
        status: "new",
        voteCount: 1,
        embedding: [0.1, 0.2],
        aiSummary: "tóm tắt",
        aiTags: ["bug"],
        suggestion: null,
        resolutionNote: null,
        url: null,
        entityRef: null,
        authorUserId: "user_test_1",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      enqueueSelect([row]);
      enqueueSelect([{ userId: "user_test_1" }]); // myVote check
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).get(VALID_UUID);
      expect(r.myVote).toBe(true);
      // embedding KHÔNG được trả về (768 floats, tốn băng thông).
      expect("embedding" in r).toBe(false);
    });

    it("404 khi feedback không tồn tại", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).get(VALID_UUID), "NOT_FOUND");
    });

    it("validation: id phải UUID", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(() => caller(ctx).get("not-uuid"), "BAD_REQUEST");
    });
  });

  describe("create", () => {
    it("insert + fire-and-forget notify + enqueueAi", async () => {
      const { db, enqueueInsert } = makeMockDb();
      const row = {
        id: VALID_UUID,
        title: "Phản hồi mới",
        companyId: "co_test_1",
        authorUserId: "user_test_1",
      };
      enqueueInsert([row]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).create({
        title: "Phản hồi mới",
        body: "Mô tả đủ dài 10 chars",
        area: "ui",
      });
      expect(r.title).toBe("Phản hồi mới");

      // Verify notify + AI enqueue called (fire-and-forget — bypass await).
      const { notifyAdmins, notifyMentions } = await import("./notifications-router");
      const { enqueueFeedbackAi } = await import("./feedback-ai");
      const { logActivity } = await import("./activity");
      await Promise.resolve(); // flush microtasks for void calls
      expect(notifyAdmins).toHaveBeenCalled();
      expect(notifyMentions).toHaveBeenCalled();
      expect(enqueueFeedbackAi).toHaveBeenCalledWith(VALID_UUID);
      expect(logActivity).toHaveBeenCalled();
    });

    it("validation: title min 3, body min 10", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () => caller(ctx).create({ title: "ab", body: "short", area: "ui" }),
        "BAD_REQUEST",
      );
    });

    it("validation: area enum strict", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(
        () =>
          caller(ctx).create({
            title: "abc",
            body: "body đủ 10 chars",
            area: "invalid" as never,
          }),
        "BAD_REQUEST",
      );
    });
  });

  describe("setStatus", () => {
    it("admin đổi status được + log activity", async () => {
      const { db, enqueueSelect } = makeMockDb();
      // first select: feedback row
      enqueueSelect([
        {
          id: VALID_UUID,
          status: "new",
          title: "X",
          authorUserId: "other_user",
          companyId: "co_test_1",
          resolutionNote: null,
        },
      ]);
      // second select: feedbackComments author list (for notify)
      enqueueSelect([{ authorUserId: "commenter_1" }]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).setStatus({
        id: VALID_UUID,
        status: "in_progress",
      });
      expect(r).toEqual({ ok: true });
    });

    it("idempotent: status không đổi → ok không update", async () => {
      const { db, enqueueSelect, ops } = makeMockDb();
      enqueueSelect([
        {
          id: VALID_UUID,
          status: "in_progress",
          title: "X",
          authorUserId: "x",
          companyId: "co_test_1",
          resolutionNote: null,
        },
      ]);
      const ctx = makeMockCtx({ db });
      await caller(ctx).setStatus({ id: VALID_UUID, status: "in_progress" });
      expect(ops.filter((o) => o.kind === "update")).toHaveLength(0);
    });

    it("RBAC: viewer không có edit:activity → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(
        () => caller(ctx).setStatus({ id: VALID_UUID, status: "done" }),
        "FORBIDDEN",
      );
    });
  });

  describe("vote / unvote", () => {
    it("vote insert + update voteCount", async () => {
      const { db, ops, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID }]); // assertFeedbackInCompany — guard cross-tenant
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).vote(VALID_UUID);
      expect(r).toEqual({ ok: true });
      // Insert vote row + execute count update.
      expect(ops.some((o) => o.kind === "insert")).toBe(true);
      expect(ops.some((o) => o.kind === "execute")).toBe(true);
    });

    it("unvote delete + update voteCount", async () => {
      const { db, ops, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID }]); // assertFeedbackInCompany — guard cross-tenant
      const ctx = makeMockCtx({ db });
      await caller(ctx).unvote(VALID_UUID);
      expect(ops.some((o) => o.kind === "delete")).toBe(true);
      expect(ops.some((o) => o.kind === "execute")).toBe(true);
    });

    it("vote: feedback công ty khác → NOT_FOUND (guard cross-tenant)", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]); // assertFeedbackInCompany không thấy → chặn
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).vote(VALID_UUID), "NOT_FOUND");
    });
  });

  describe("comments", () => {
    it("listComments trả mảng sắp xếp theo createdAt", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID }]); // feedback exists check
      enqueueSelect([
        {
          id: VALID_UUID,
          parentId: null,
          authorUserId: "u1",
          body: "Comment 1",
          createdAt: new Date(),
        },
        {
          id: VALID_UUID_2,
          parentId: null,
          authorUserId: "u2",
          body: "Comment 2",
          createdAt: new Date(),
        },
      ]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).listComments(VALID_UUID);
      expect(r).toHaveLength(2);
    });

    it("addComment insert + notifyMentions", async () => {
      const { db, enqueueSelect, enqueueInsert } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID, title: "X" }]); // feedback check
      enqueueInsert([{ id: VALID_UUID_2, body: "Cảm ơn" }]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).addComment({
        feedbackId: VALID_UUID,
        body: "Cảm ơn @user1",
      });
      expect(r?.id).toBe(VALID_UUID_2);
      const { notifyMentions } = await import("./notifications-router");
      await Promise.resolve();
      expect(notifyMentions).toHaveBeenCalled();
    });
  });

  describe("findSimilar", () => {
    it("trả mảng rỗng nếu embed fail", async () => {
      // Mock embedTexts throw để verify graceful degrade
      const { embedTexts } = await import("./embeddings");
      vi.mocked(embedTexts).mockRejectedValueOnce(new Error("no profile"));
      const ctx = makeMockCtx();
      const r = await caller(ctx).findSimilar({
        title: "abc xyz",
        body: "test",
      });
      expect(r).toEqual([]);
    });

    it("validation: title min 3", async () => {
      const ctx = makeMockCtx();
      await assertThrowsTRPCError(() => caller(ctx).findSimilar({ title: "ab" }), "BAD_REQUEST");
    });
  });

  describe("mergeExport", () => {
    const FB_ROW = {
      id: VALID_UUID,
      title: "Lỗi đăng nhập",
      body: "Không nhớ phiên",
      suggestion: "Thêm Remember me",
      area: "ui",
      severity: "normal",
      status: "new",
      voteCount: 3,
      authorUserId: "user_test_1",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    };

    it("admin: ghép thẳng → mode raw + count", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([FB_ROW]); // feedbacks
      enqueueSelect([{ id: "user_test_1", name: "Anh Tú" }]); // authors
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).mergeExport({});
      expect(r.mode).toBe("raw");
      expect(r.count).toBe(1);
      expect(r.markdown).toContain("Lỗi đăng nhập");
      expect(r.markdown).toContain("Anh Tú");
    });

    it("ai=true + LLM trả document → mode ai", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([FB_ROW]);
      enqueueSelect([{ id: "user_test_1", name: "Anh Tú" }]);
      const { callLlmJson } = await import("./llm-json");
      vi.mocked(callLlmJson).mockResolvedValueOnce({ document: "# Bản tổng hợp AI" });
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).mergeExport({ ai: true });
      expect(r.mode).toBe("ai");
      expect(r.markdown).toBe("# Bản tổng hợp AI");
    });

    it("ai=true + LLM null (chưa cấu hình) → fail-safe raw + aiFailed", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([FB_ROW]);
      enqueueSelect([{ id: "user_test_1", name: "Anh Tú" }]);
      const { callLlmJson } = await import("./llm-json");
      vi.mocked(callLlmJson).mockResolvedValueOnce(null);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).mergeExport({ ai: true });
      expect(r.mode).toBe("raw");
      expect(r.aiFailed).toBe(true);
    });

    it("RBAC: viewer không có edit:feedback → FORBIDDEN", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(() => caller(ctx).mergeExport({}), "FORBIDDEN");
    });
  });

  describe("merge batches", () => {
    it("saveMergeBatch: lưu snapshot id + count", async () => {
      const { db, enqueueSelect, enqueueInsert } = makeMockDb();
      enqueueSelect([{ id: VALID_UUID }, { id: VALID_UUID_2 }]); // tập filter
      enqueueInsert([{ id: "batch1", label: "Đợt 1", itemCount: 2 }]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).saveMergeBatch({ label: "Đợt 1" });
      expect(r?.itemCount).toBe(2);
    });

    it("saveMergeBatch: không có mục → BAD_REQUEST", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).saveMergeBatch({}), "BAD_REQUEST");
    });

    it("listMergeBatches: trả danh sách của company", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        { id: "b1", label: "Đợt 1", note: null, itemCount: 3, createdAt: new Date() },
      ]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).listMergeBatches();
      expect(r).toHaveLength(1);
    });

    it("getMergeBatch: trả batch + items hiện tại", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([
        {
          id: "b1",
          companyId: "co_test_1",
          label: "Đợt 1",
          note: null,
          filterSnapshot: null,
          feedbackIds: [VALID_UUID],
          itemCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: "user_test_1",
        },
      ]);
      enqueueSelect([{ id: VALID_UUID, title: "A", status: "new" }]);
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).getMergeBatch(VALID_UUID_2);
      expect(r.label).toBe("Đợt 1");
      expect(r.items).toHaveLength(1);
    });

    it("getMergeBatch: không tồn tại → NOT_FOUND", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      const ctx = makeMockCtx({ db });
      await assertThrowsTRPCError(() => caller(ctx).getMergeBatch(VALID_UUID_2), "NOT_FOUND");
    });

    it("deleteMergeBatch: xoá row", async () => {
      const { db, ops } = makeMockDb();
      const ctx = makeMockCtx({ db });
      const r = await caller(ctx).deleteMergeBatch(VALID_UUID_2);
      expect(r).toEqual({ ok: true });
      expect(ops.some((o) => o.kind === "delete")).toBe(true);
    });

    it("RBAC: viewer → FORBIDDEN (save/list)", async () => {
      const ctx = makeMockCtx({ user: makeMockUser({ role: "viewer" }) });
      await assertThrowsTRPCError(() => caller(ctx).saveMergeBatch({}), "FORBIDDEN");
      await assertThrowsTRPCError(() => caller(ctx).listMergeBatches(), "FORBIDDEN");
    });
  });

  describe("buildMergeMarkdown", () => {
    it("nhóm theo area + đếm + chèn tác giả/đề xuất", () => {
      const authors = new Map([
        ["u1", "Anh Tú"],
        ["u2", "Bình"],
      ]);
      const md = buildMergeMarkdown(
        [
          {
            id: "f1",
            title: "A",
            body: "body a",
            suggestion: "sugg a",
            area: "ui",
            severity: "normal",
            status: "new",
            voteCount: 2,
            authorUserId: "u1",
            createdAt: new Date("2026-06-01T00:00:00Z"),
          },
          {
            id: "f2",
            title: "B",
            body: "body b",
            suggestion: null,
            area: "ui",
            severity: "blocker",
            status: "new",
            voteCount: 5,
            authorUserId: "u2",
            createdAt: new Date("2026-06-02T00:00:00Z"),
          },
          {
            id: "f3",
            title: "C",
            body: "body c",
            suggestion: null,
            area: "workflow",
            severity: "normal",
            status: "in_progress",
            voteCount: 0,
            authorUserId: "u1",
            createdAt: new Date("2026-06-03T00:00:00Z"),
          },
        ],
        authors,
      );
      expect(md).toContain("(3 mục)");
      expect(md).toContain("## Giao diện (2)");
      expect(md).toContain("## Quy trình (1)");
      expect(md).toContain("- Đề xuất: sugg a");
      expect(md).toContain("Anh Tú");
      expect(md).toContain("2026-06-01");
    });

    it("rỗng → trả tài liệu placeholder", () => {
      expect(buildMergeMarkdown([], new Map())).toContain("Không có mục nào");
    });
  });
});
