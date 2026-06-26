/* ==========================================================
   ws-channels.ts — WS channel allowlist + scope check (P4.1).
   ────────────────────────────────────────────────────────────
   Tách khỏi index.ts để unit-test được không phải boot Fastify
   + tRPC + plugins (side-effect heavy).

   Patterns hiện hữu:
   - notifications:<userId>            — chỉ user của chính mình
   - approval:<userId>                 — approval flow notifications
   - record:<entityName>:<companyId>   — chỉ company hiện tại
   - presence:<recordId>               — UUID; KHÔNG check company-bound
                                         ở đây (cần DB lookup, defer);
                                         worst case: nhận event presence
                                         không liên quan, payload chỉ
                                         là user list editing, không
                                         leak data nhạy cảm.
   - migration:<userId>                — UI migration nhận progress job
                                         (start/log/done/error) chỉ user
                                         khởi job.
   - chat-inbox:<userId>               — cập nhật danh sách/badge chat của
                                         chính user (tin mới / hội thoại mới).
   - chat:<conversationId>             — tin nhắn trong 1 hội thoại. Ở đây
                                         CHỈ check format UUID; membership
                                         (caller có thuộc hội thoại không +
                                         cùng company) verify bằng DB lookup
                                         ở /ws handler (index.ts) trước khi
                                         subscribe — tin nhắn nhạy cảm hơn
                                         presence nên KHÔNG để format-only.
   - other                             → reject (silently drop ở caller)
   ========================================================== */

const RECORD_CH = /^record:[a-z][a-z0-9_]*:([0-9a-f-]{36})$/;
const UUID_RE = /^[0-9a-f-]{36}$/;

export function isChannelAllowed(channel: string, userId: string, companyId: string): boolean {
  if (channel === `notifications:${userId}`) return true;
  if (channel === `approval:${userId}`) return true;
  if (channel === `migration:${userId}`) return true;
  if (channel === `chat-inbox:${userId}`) return true;
  const m = channel.match(RECORD_CH);
  if (m) return m[1] === companyId;
  if (channel.startsWith("presence:")) {
    return UUID_RE.test(channel.slice("presence:".length));
  }
  if (channel.startsWith("chat:")) {
    return UUID_RE.test(channel.slice("chat:".length));
  }
  return false;
}
