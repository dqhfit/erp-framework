/* ==========================================================
   mcp-feedback.test.ts — Scope gate + helper thuần của MCP server.
   Không chạm DB: kiểm tra deny-by-default + reject tool lạ + cosine.
   ========================================================== */
import { describe, expect, it } from "vitest";
import type { ApiKeyContext } from "./api-key-auth";
import type { DB } from "./db";
import { callFeedbackTool, cosine, hasFeedbackScope, parseVec } from "./mcp-feedback";

const ctx = (scopes: string[]): ApiKeyContext => ({
  id: "key-1",
  companyId: "11111111-1111-4111-8111-111111111111",
  scopes,
});
const fakeDb = {} as DB; // không được chạm tới vì scope chặn trước

describe("hasFeedbackScope", () => {
  it('"*" cho cả read lẫn propose', () => {
    expect(hasFeedbackScope(["*"], "read")).toBe(true);
    expect(hasFeedbackScope(["*"], "propose")).toBe(true);
  });
  it('"feedback:*" cho cả hai', () => {
    expect(hasFeedbackScope(["feedback:*"], "read")).toBe(true);
    expect(hasFeedbackScope(["feedback:*"], "propose")).toBe(true);
  });
  it('"feedback:read" chỉ đọc, không propose', () => {
    expect(hasFeedbackScope(["feedback:read"], "read")).toBe(true);
    expect(hasFeedbackScope(["feedback:read"], "propose")).toBe(false);
  });
  it('"feedback:propose" bao gồm cả đọc', () => {
    expect(hasFeedbackScope(["feedback:propose"], "read")).toBe(true);
    expect(hasFeedbackScope(["feedback:propose"], "propose")).toBe(true);
  });
  it("scope rỗng = deny-by-default", () => {
    expect(hasFeedbackScope([], "read")).toBe(false);
    expect(hasFeedbackScope([], "propose")).toBe(false);
    expect(hasFeedbackScope(["entity:foo:read"], "read")).toBe(false);
  });
  it('"feedback:apply" áp được + bao đọc, nhưng KHÔNG propose', () => {
    expect(hasFeedbackScope(["feedback:apply"], "apply")).toBe(true);
    expect(hasFeedbackScope(["feedback:apply"], "read")).toBe(true);
    expect(hasFeedbackScope(["feedback:apply"], "propose")).toBe(false);
  });
  it("read/propose KHÔNG đủ để apply; * và feedback:* thì đủ", () => {
    expect(hasFeedbackScope(["feedback:read"], "apply")).toBe(false);
    expect(hasFeedbackScope(["feedback:propose"], "apply")).toBe(false);
    expect(hasFeedbackScope(["*"], "apply")).toBe(true);
    expect(hasFeedbackScope(["feedback:*"], "apply")).toBe(true);
  });
});

describe("callFeedbackTool — scope gate", () => {
  it("chặn tool đọc khi thiếu scope (không chạm DB)", async () => {
    await expect(callFeedbackTool(fakeDb, ctx([]), "feedback_list", {})).rejects.toThrow(/scope/i);
  });
  it("chặn tool propose khi chỉ có read", async () => {
    await expect(
      callFeedbackTool(fakeDb, ctx(["feedback:read"]), "proposal_create", {
        title: "x",
        actions: [],
      }),
    ).rejects.toThrow(/scope/i);
  });
  it("tool không tồn tại → lỗi", async () => {
    await expect(callFeedbackTool(fakeDb, ctx(["*"]), "rm_rf", {})).rejects.toThrow(
      /không tồn tại/i,
    );
  });
  it("chặn feedback_set_status khi chỉ có propose (cần apply)", async () => {
    await expect(
      callFeedbackTool(fakeDb, ctx(["feedback:propose"]), "feedback_set_status", {
        feedbackIds: ["00000000-0000-0000-0000-000000000001"],
        status: "done",
      }),
    ).rejects.toThrow(/scope/i);
  });
});

describe("cosine + parseVec", () => {
  it("cosine vector trùng = 1", () => {
    expect(cosine([1, 0, 1], [1, 0, 1])).toBeCloseTo(1, 6);
  });
  it("cosine vector vuông góc = 0", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it("parseVec nhận mảng và chuỗi pgvector", () => {
    expect(parseVec([1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseVec("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseVec("not-json")).toBeNull();
    expect(parseVec(42)).toBeNull();
  });
});
