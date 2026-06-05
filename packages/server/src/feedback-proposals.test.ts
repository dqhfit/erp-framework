/* ==========================================================
   feedback-proposals.test.ts — Validate ZProposalAction(s).
   Tập trung vào ràng buộc add_to_roadmap (cần roadmapId HOẶC roadmap)
   và phân loại discriminated union theo `type`.
   ========================================================== */
import { describe, expect, it } from "vitest";
import { ZProposalAction, ZProposalActions } from "./feedback-proposals";

const UID = "11111111-1111-4111-8111-111111111111";
const UID2 = "22222222-2222-4222-8222-222222222222";

describe("ZProposalAction", () => {
  it("chấp nhận set_status hợp lệ", () => {
    const r = ZProposalAction.safeParse({
      type: "set_status",
      feedbackIds: [UID, UID2],
      status: "in_progress",
    });
    expect(r.success).toBe(true);
  });

  it("từ chối status sai", () => {
    const r = ZProposalAction.safeParse({
      type: "set_status",
      feedbackIds: [UID],
      status: "bogus",
    });
    expect(r.success).toBe(false);
  });

  it("chấp nhận mark_duplicate", () => {
    const r = ZProposalAction.safeParse({
      type: "mark_duplicate",
      primaryId: UID,
      duplicateIds: [UID2],
    });
    expect(r.success).toBe(true);
  });

  it("add_to_roadmap CẦN roadmapId hoặc roadmap", () => {
    const bad = ZProposalAction.safeParse({ type: "add_to_roadmap", feedbackIds: [UID] });
    expect(bad.success).toBe(false);
  });

  it("add_to_roadmap với roadmap mới hợp lệ", () => {
    const r = ZProposalAction.safeParse({
      type: "add_to_roadmap",
      feedbackIds: [UID],
      roadmap: { title: "Cải thiện X", priority: "high" },
    });
    expect(r.success).toBe(true);
  });

  it("add_to_roadmap gắn roadmapId có sẵn hợp lệ", () => {
    const r = ZProposalAction.safeParse({ type: "add_to_roadmap", roadmapId: UID });
    expect(r.success).toBe(true);
  });

  it("type không hợp lệ bị loại", () => {
    expect(ZProposalAction.safeParse({ type: "drop_table" }).success).toBe(false);
  });
});

describe("ZProposalActions", () => {
  it("cần ít nhất 1 hành động", () => {
    expect(ZProposalActions.safeParse([]).success).toBe(false);
  });

  it("nhiều hành động trộn loại", () => {
    const r = ZProposalActions.safeParse([
      { type: "set_status", feedbackIds: [UID], status: "done" },
      { type: "add_to_roadmap", roadmapId: UID2 },
    ]);
    expect(r.success).toBe(true);
  });
});
