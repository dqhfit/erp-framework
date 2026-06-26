/* ==========================================================
   ws-channels.test.ts — Regression test cho WS allowlist (P4.1).
   Trước đây /ws handler trust caller cho channel "record:*:*" →
   subscribe được event của công ty khác. Test chốt cross-tenant
   guard + pattern allowlist.
   ========================================================== */
import { describe, expect, it } from "vitest";
import { isChannelAllowed } from "./ws-channels";

const U1 = "user-1";
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("isChannelAllowed (P4.1)", () => {
  describe("notifications:<userId>", () => {
    it("pass khi khớp userId", () => {
      expect(isChannelAllowed(`notifications:${U1}`, U1, C1)).toBe(true);
    });
    it("reject khi userId khác (không subscribe được notif của user khác)", () => {
      expect(isChannelAllowed("notifications:other-user", U1, C1)).toBe(false);
    });
  });

  describe("approval:<userId>", () => {
    it("pass khi khớp userId", () => {
      expect(isChannelAllowed(`approval:${U1}`, U1, C1)).toBe(true);
    });
    it("reject userId khác", () => {
      expect(isChannelAllowed("approval:other-user", U1, C1)).toBe(false);
    });
  });

  describe("record:<entity>:<companyId> (cross-tenant guard)", () => {
    it("pass khi companyId khớp", () => {
      expect(isChannelAllowed(`record:orders:${C1}`, U1, C1)).toBe(true);
    });

    it("REJECT khi companyId khác — chốt cứng cross-tenant", () => {
      expect(isChannelAllowed(`record:orders:${C2}`, U1, C1)).toBe(false);
    });

    it("Entity name format hợp lệ (lowercase + underscore)", () => {
      expect(isChannelAllowed(`record:order_items:${C1}`, U1, C1)).toBe(true);
    });

    it("Reject entity name viết hoa hoặc ký tự lạ", () => {
      expect(isChannelAllowed(`record:Orders:${C1}`, U1, C1)).toBe(false);
      expect(isChannelAllowed(`record:orders-2:${C1}`, U1, C1)).toBe(false);
    });

    it("Reject companyId không phải UUID", () => {
      expect(isChannelAllowed("record:orders:not-uuid", U1, C1)).toBe(false);
    });
  });

  describe("presence:<recordId>", () => {
    it("pass khi recordId là UUID hợp lệ", () => {
      expect(isChannelAllowed(`presence:${R1}`, U1, C1)).toBe(true);
    });

    it("Reject presence không có UUID", () => {
      expect(isChannelAllowed("presence:bad-format", U1, C1)).toBe(false);
      expect(isChannelAllowed("presence:", U1, C1)).toBe(false);
    });
  });

  describe("chat-inbox:<userId>", () => {
    it("pass khi khớp userId", () => {
      expect(isChannelAllowed(`chat-inbox:${U1}`, U1, C1)).toBe(true);
    });
    it("reject userId khác", () => {
      expect(isChannelAllowed("chat-inbox:other-user", U1, C1)).toBe(false);
    });
  });

  describe("chat:<conversationId> (format-only; membership verify ở /ws)", () => {
    it("pass khi là UUID hợp lệ", () => {
      expect(isChannelAllowed(`chat:${R1}`, U1, C1)).toBe(true);
    });
    it("reject khi không phải UUID", () => {
      expect(isChannelAllowed("chat:bad", U1, C1)).toBe(false);
      expect(isChannelAllowed("chat:", U1, C1)).toBe(false);
    });
  });

  describe("Channel ngoài whitelist", () => {
    it("Reject channel arbitrary", () => {
      expect(isChannelAllowed("foo:bar", U1, C1)).toBe(false);
      expect(isChannelAllowed("admin:secret", U1, C1)).toBe(false);
      expect(isChannelAllowed("", U1, C1)).toBe(false);
    });

    it("Reject prefix trùng tên nhưng pattern sai", () => {
      // "notifications:" thiếu userId
      expect(isChannelAllowed("notifications:", U1, C1)).toBe(false);
      // "record:" thiếu entity:company
      expect(isChannelAllowed("record:", U1, C1)).toBe(false);
    });
  });
});
