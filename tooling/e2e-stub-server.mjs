#!/usr/bin/env node
/* ==========================================================
   e2e-stub-server.mjs — Stub các dịch vụ ngoài cho e2e.
   Một HTTP server thuần (cổng 9100) thay cho:
   - Embedding API  (OpenAI-compat /v1/embeddings) — vector 768
     chiều sinh bằng bag-of-words hashing: cosine phản ánh độ
     trùng từ → test tìm kiếm KB có ý nghĩa.
   - LLM chat       (/v1/chat/completions + /v1/messages) — trả
     completion canned cho agent chat.
   - Apache Tika    (PUT /tika) — trả lại body dạng text.
   Không phụ thuộc thư viện npm. Khởi động bởi playwright.fullstack.
   ========================================================== */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 9100);
const DIM = 768;

/** Băm chuỗi → số nguyên không âm (djb2). */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Văn bản → vector 768 chiều (bag-of-words hashing). */
function embed(text) {
  const v = new Array(DIM).fill(0);
  const words = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const w of words) v[hash(w) % DIM] += 1;
  // Tránh vector toàn 0 (cosine không xác định).
  if (words.length === 0) v[0] = 1;
  return v;
}

/** Đọc toàn bộ body request. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (req.method === "GET" && path === "/health") {
    return sendJson(res, 200, { ok: true, service: "e2e-stub" });
  }

  // Embedding — OpenAI-compatible.
  if (req.method === "POST" && path === "/v1/embeddings") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const input = Array.isArray(body.input) ? body.input : [body.input ?? ""];
    return sendJson(res, 200, {
      data: input.map((text, index) => ({ object: "embedding", index, embedding: embed(text) })),
      model: body.model ?? "stub-embed",
      usage: { prompt_tokens: input.join(" ").length, total_tokens: input.join(" ").length },
    });
  }

  // LLM chat — OpenAI-compatible.
  if (req.method === "POST" && path === "/v1/chat/completions") {
    return sendJson(res, 200, {
      id: "stub-cmpl",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "(stub e2e) Đã nhận yêu cầu của bạn." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 8, total_tokens: 9 },
    });
  }

  // LLM chat — Anthropic Messages.
  if (req.method === "POST" && path === "/v1/messages") {
    return sendJson(res, 200, {
      id: "stub-msg",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "(stub e2e) Đã nhận yêu cầu của bạn." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 8 },
    });
  }

  // Apache Tika — trả lại nội dung file dạng text (đủ cho .txt/.md).
  if (req.method === "PUT" && path === "/tika") {
    const body = await readBody(req);
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end(body.toString("utf8"));
  }

  sendJson(res, 404, { error: `stub: không hỗ trợ ${req.method} ${path}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`e2e-stub-server → http://127.0.0.1:${PORT}`);
});
