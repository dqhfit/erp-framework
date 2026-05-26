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
   - other                             → reject (silently drop ở caller)
   ========================================================== */

const RECORD_CH = /^record:[a-z][a-z0-9_]*:([0-9a-f-]{36})$/;
const UUID_RE = /^[0-9a-f-]{36}$/;

export function isChannelAllowed(channel: string, userId: string, companyId: string): boolean {
  if (channel === `notifications:${userId}`) return true;
  if (channel === `approval:${userId}`) return true;
  const m = channel.match(RECORD_CH);
  if (m) return m[1] === companyId;
  if (channel.startsWith("presence:")) {
    return UUID_RE.test(channel.slice("presence:".length));
  }
  return false;
}
