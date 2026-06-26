/* ==========================================================
   chat-router.test.ts — Unit test chat noi bo.
   Trong tam: membership-gate (nguoi ngoai hoi thoai bi chan), DM dedupe,
   tu-nhan-tin bi chan, markRead gate. Mock ws-hub + notifications de
   khong dung DB/realtime ngoai y muon.
   ========================================================== */
import { describe, expect, it, vi } from "vitest";
import { chatRouter } from "./chat-router";
import { assertThrowsTRPCError, makeMockCtx, makeMockDb, makeMockUser } from "./test-helpers";
import { createCallerFactory } from "./trpc";

vi.mock("./ws-hub", () => ({ publish: vi.fn() }));
vi.mock("./notifications-router", () => ({ notifyMentions: vi.fn().mockResolvedValue(undefined) }));

const caller = createCallerFactory(chatRouter);
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";

function ctxFor(db: ReturnType<typeof makeMockDb>["db"]) {
  return makeMockCtx({ db, user: makeMockUser({ id: ME, companyId: "co_1" }) });
}

describe("chat-router", () => {
  describe("messages.send — membership gate", () => {
    it("FORBIDDEN khi caller khong thuoc hoi thoai", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]); // isChatMember → khong co dong → khong phai thanh vien
      await assertThrowsTRPCError(
        () => caller(ctxFor(db)).messages.send({ conversationId: CONV, body: "hi" }),
        "FORBIDDEN",
      );
    });

    it("gui duoc khi la thanh vien — tra ve id tin nhan", async () => {
      const { db, enqueueSelect, enqueueInsert } = makeMockDb();
      enqueueSelect([{ userId: ME }]); // isChatMember → la thanh vien
      enqueueInsert([{ id: "msg-1", createdAt: new Date() }]); // insert message
      enqueueSelect([{ userId: OTHER }]); // otherMemberIds
      const r = await caller(ctxFor(db)).messages.send({ conversationId: CONV, body: "xin chao" });
      expect(r.id).toBe("msg-1");
    });

    it("BAD_REQUEST khi body rong va khong co dinh kem", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ userId: ME }]); // la thanh vien
      await assertThrowsTRPCError(
        () => caller(ctxFor(db)).messages.send({ conversationId: CONV, body: "   " }),
        "BAD_REQUEST",
      );
    });

    it("gui duoc tin CHI co dinh kem (body rong)", async () => {
      const { db, enqueueSelect, enqueueInsert } = makeMockDb();
      enqueueSelect([{ userId: ME }]); // la thanh vien
      enqueueInsert([{ id: "msg-2", createdAt: new Date() }]); // insert
      enqueueSelect([{ userId: OTHER }]); // otherMemberIds
      const r = await caller(ctxFor(db)).messages.send({
        conversationId: CONV,
        body: "",
        attachments: [
          { url: "/f/abc.def/anh.png", name: "anh.png", mime: "image/png", size: 1234 },
        ],
      });
      expect(r.id).toBe("msg-2");
    });

    it("tu choi URL dinh kem ngoai (khong phai /f/)", async () => {
      const { db } = makeMockDb();
      // zod chan truoc khi cham DB → BAD_REQUEST.
      await assertThrowsTRPCError(
        () =>
          caller(ctxFor(db)).messages.send({
            conversationId: CONV,
            body: "x",
            attachments: [{ url: "https://evil.example/x.png", name: "x.png" }],
          }),
        "BAD_REQUEST",
      );
    });
  });

  describe("messages.list — membership gate", () => {
    it("FORBIDDEN khi khong phai thanh vien", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      await assertThrowsTRPCError(
        () => caller(ctxFor(db)).messages.list({ conversationId: CONV }),
        "FORBIDDEN",
      );
    });
  });

  describe("messages.markRead — membership gate", () => {
    it("FORBIDDEN khi khong phai thanh vien", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      await assertThrowsTRPCError(
        () => caller(ctxFor(db)).messages.markRead({ conversationId: CONV }),
        "FORBIDDEN",
      );
    });
  });

  describe("conversations.openDm", () => {
    it("BAD_REQUEST khi tu nhan tin chinh minh", async () => {
      const { db } = makeMockDb();
      await assertThrowsTRPCError(
        () => caller(ctxFor(db)).conversations.openDm({ userId: ME }),
        "BAD_REQUEST",
      );
    });

    it("tra ve DM san co (created=false) — khong tao trung", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ userId: OTHER }]); // peer thuoc company
      enqueueSelect([{ id: CONV }]); // DM da ton tai theo dm_key
      const r = await caller(ctxFor(db)).conversations.openDm({ userId: OTHER });
      expect(r).toEqual({ conversationId: CONV, created: false });
    });

    it("NOT_FOUND khi doi phuong khong thuoc cong ty", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]); // peer khong co
      await assertThrowsTRPCError(
        () => caller(ctxFor(db)).conversations.openDm({ userId: OTHER }),
        "NOT_FOUND",
      );
    });
  });

  describe("directory", () => {
    it("tra ve danh ba thanh vien cong ty", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ userId: OTHER, name: "Nguyen", email: "a@b.c", role: "editor" }]);
      const r = await caller(ctxFor(db)).directory();
      expect(r).toHaveLength(1);
      expect(r[0]?.userId).toBe(OTHER);
    });
  });

  /* ─── Phase 2: edit / remove / react / typing ─── */
  describe("messages.edit", () => {
    const msgRow = { id: "m1", conversationId: CONV, senderUserId: ME, deletedAt: null };
    it("NOT_FOUND khi tin khong ton tai", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]); // loadOwnableMessage → khong co
      await assertThrowsTRPCError(
        () =>
          caller(ctxFor(db)).messages.edit({
            messageId: "11111111-1111-4111-8111-1111111111aa",
            body: "x",
          }),
        "NOT_FOUND",
      );
    });
    it("FORBIDDEN khi sua tin nguoi khac", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ ...msgRow, senderUserId: OTHER }]);
      await assertThrowsTRPCError(
        () =>
          caller(ctxFor(db)).messages.edit({
            messageId: "11111111-1111-4111-8111-1111111111aa",
            body: "x",
          }),
        "FORBIDDEN",
      );
    });
    it("sua duoc tin cua minh", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([msgRow]);
      const r = await caller(ctxFor(db)).messages.edit({
        messageId: "11111111-1111-4111-8111-1111111111aa",
        body: "noi dung moi",
      });
      expect(r).toEqual({ ok: true });
    });
  });

  describe("messages.remove", () => {
    it("FORBIDDEN khi xoa tin nguoi khac", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: "m1", conversationId: CONV, senderUserId: OTHER, deletedAt: null }]);
      await assertThrowsTRPCError(
        () =>
          caller(ctxFor(db)).messages.remove({ messageId: "11111111-1111-4111-8111-1111111111aa" }),
        "FORBIDDEN",
      );
    });
  });

  describe("messages.react", () => {
    it("FORBIDDEN khi khong thuoc hoi thoai", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: "m1", conversationId: CONV, senderUserId: OTHER, deletedAt: null }]); // load msg
      enqueueSelect([]); // isChatMember → khong phai thanh vien
      await assertThrowsTRPCError(
        () =>
          caller(ctxFor(db)).messages.react({
            messageId: "11111111-1111-4111-8111-1111111111aa",
            emoji: "👍",
          }),
        "FORBIDDEN",
      );
    });
    it("tha reaction moi → added=true", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([{ id: "m1", conversationId: CONV, senderUserId: OTHER, deletedAt: null }]); // load msg
      enqueueSelect([{ userId: ME }]); // isChatMember → la thanh vien
      enqueueSelect([]); // chua co reaction → insert
      const r = await caller(ctxFor(db)).messages.react({
        messageId: "11111111-1111-4111-8111-1111111111aa",
        emoji: "👍",
      });
      expect(r).toEqual({ added: true });
    });
  });

  describe("messages.typing", () => {
    it("FORBIDDEN khi khong phai thanh vien", async () => {
      const { db, enqueueSelect } = makeMockDb();
      enqueueSelect([]);
      await assertThrowsTRPCError(
        () => caller(ctxFor(db)).messages.typing({ conversationId: CONV }),
        "FORBIDDEN",
      );
    });
  });
});
