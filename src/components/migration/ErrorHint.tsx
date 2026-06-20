/* ErrorHint — gợi ý xử lý theo mã lỗi LLM/network khi enrich/codegen.
   Dùng chung nhiều tab trong settings.migration. */
export function ErrorHint({ code }: { code: string }) {
  let hint = "";
  if (code.startsWith("no_profile")) {
    hint =
      "→ Vào Settings → LLM, tạo profile kind=chat (vd Anthropic Claude Sonnet) + dán API key.";
  } else if (code.startsWith("no_api_key")) {
    hint =
      "→ Mở profile, dán API key (Anthropic / OpenAI). Hoặc set env ANTHROPIC_API_KEY / OPENAI_API_KEY.";
  } else if (code.startsWith("http_401") || code.startsWith("http_403")) {
    hint =
      "→ API key sai hoặc hết quota / billing chưa setup. Check Anthropic Console / OpenAI Platform.";
  } else if (code.startsWith("http_429")) {
    hint = "→ Rate limit. Chờ vài giây, hoặc giảm tốc độ enrich.";
  } else if (code.startsWith("http_4")) {
    hint =
      "→ Request invalid — check model name trong profile có đúng (vd 'claude-sonnet-4-6' không phải 'claude-4-sonnet').";
  } else if (code.startsWith("http_5")) {
    hint = "→ API server lỗi tạm thời. Thử lại sau.";
  } else if (code.startsWith("timeout")) {
    hint = "→ Prompt quá dài hoặc API chậm. Tăng maxTokens hoặc retry.";
  } else if (code.startsWith("no_json")) {
    hint =
      "→ AI trả text không phải JSON. Có thể model thiếu hiểu prompt — check Raw response bên dưới + sửa prompt/STYLE.md.";
  } else if (code.startsWith("parse_fail")) {
    hint = "→ AI trả JSON malformed. Check Raw để xem AI nói gì.";
  } else if (code.startsWith("fetch_")) {
    hint = "→ Lỗi mạng. Check endpoint trong profile, network connection.";
  }
  if (!hint) return null;
  return <div className="text-[10px] text-muted">{hint}</div>;
}
