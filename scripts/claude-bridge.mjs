#!/usr/bin/env node
/* ==========================================================
   claude-bridge.mjs — HTTP bridge cho ERP Framework
   ==========================================================
   2 chức năng:
   1. Proxy Claude CLI (POST /v1/messages)
   2. Config storage (GET/POST /config/:key → file JSON)
   ========================================================== */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { promises as fs, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "8909", 10);
// Bind localhost only — tránh EACCES khi 0.0.0.0:PORT bị Windows Hyper-V reserve
const HOST = process.env.HOST || "127.0.0.1";
const CLAUDE_CMD = process.env.CLAUDE_CMD || "claude";
const CONFIG_DIR = process.env.CONFIG_DIR || resolve(__dirname, "..", ".bridge-data");

if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

// ============ Dynamic model list via CLI ============
const MODELS_CACHE_FILE = resolve(CONFIG_DIR, "_models-cache.json");
const MODELS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const HARDCODED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

async function readModelsCache() {
  try {
    const raw = await fs.readFile(MODELS_CACHE_FILE, "utf8");
    const c = JSON.parse(raw);
    if (Date.now() - c.at < MODELS_CACHE_TTL && Array.isArray(c.models) && c.models.length) {
      return c.models;
    }
  } catch { /* no cache */ }
  return null;
}
async function writeModelsCache(models) {
  try {
    await fs.writeFile(MODELS_CACHE_FILE, JSON.stringify({ at: Date.now(), models }, null, 2));
  } catch { /* ignore */ }
}

async function listModelsViaCli() {
  // Hỏi Claude tự liệt kê. Yêu cầu strict JSON array để dễ parse.
  const prompt =
    "List ALL Claude model IDs that are currently available via the Anthropic API " +
    "(e.g. \"claude-opus-4-6\", \"claude-sonnet-4-6\", \"claude-haiku-4-5\"). " +
    "Return ONLY a single JSON array of strings, no prose, no markdown fences, no commentary. " +
    "Example: [\"claude-opus-4-6\",\"claude-sonnet-4-6\"]";

  const args = ["-p", "--output-format=json", prompt];
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(CLAUDE_CMD, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      rejectFn(new Error("CLI timeout 30s"));
    }, 30000);
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", (e) => { clearTimeout(timeout); rejectFn(e); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return rejectFn(new Error(`CLI exit ${code}: ${stderr.slice(0, 300)}`));
      try {
        // claude -p --output-format=json wraps response in { result: "..." } or { text: "..." }
        let text = stdout;
        try {
          const wrapper = JSON.parse(stdout);
          text = wrapper.result || wrapper.text || wrapper.message || stdout;
        } catch { /* not JSON wrapper, treat as raw text */ }

        // Extract JSON array from text
        const match = text.match(/\[\s*"[^"]+(?:"\s*,\s*"[^"]+)*"\s*\]/);
        if (!match) throw new Error("Không tìm thấy JSON array trong response");
        const models = JSON.parse(match[0]);
        if (!Array.isArray(models) || !models.length) throw new Error("Array rỗng");
        resolveFn(models.filter((m) => typeof m === "string" && m.trim()));
      } catch (e) {
        rejectFn(new Error(`Parse fail: ${e.message}\nRaw: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, anthropic-version",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function safeKey(key) {
  // Chỉ cho phép alphanumeric + dash + underscore + dot, max 64 chars
  if (!/^[a-zA-Z0-9_\-.]{1,64}$/.test(key)) throw new Error("Invalid config key");
  return key;
}

/* ─── Tool-calling qua prompt (claude CLI không có protocol tool_use) ───
   Bridge nhúng mô tả tool vào prompt, model xuất 1 khối ```tool_call JSON,
   bridge parse → trả về Anthropic tool_use block. Nhờ vậy agent-chat /
   workflow dùng claude-cli gọi được tool (knowledge_search, record_*, MCP…). */

/** Render content 1 message thành text — xử lý cả string lẫn mảng block
 *  (text / tool_use / tool_result) mà agent-chat gửi ở các vòng sau. */
function renderContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (b.type === "text") return b.text || "";
        if (b.type === "tool_use")
          return `[Đã gọi công cụ ${b.name} với input: ${JSON.stringify(b.input ?? {})}]`;
        if (b.type === "tool_result") {
          const c = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
          return `[Kết quả công cụ:\n${c}]`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

/** Hướng dẫn + danh sách tool để nhúng vào system prompt. */
function buildToolInstructions(tools) {
  if (!Array.isArray(tools) || !tools.length) return "";
  const list = tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description || ""}\n  input schema: ${JSON.stringify(t.input_schema || {})}`,
    )
    .join("\n");
  // Framing TÍCH CỰC, đơn giản — quan trọng: phủ định danh tính ("bạn không phải
  // Claude Code") khiến model phòng thủ ngược và từ chối. Cứ khẳng định tool có thật.
  return (
    "\n\nBạn có các CÔNG CỤ sau (do hệ thống ERP cung cấp, CÓ THẬT):\n" +
    list +
    "\nKhi cần dùng công cụ để lấy dữ liệu nội bộ / thực hiện hành động, CHỈ xuất MỘT " +
    "khối duy nhất, KHÔNG kèm văn bản khác:\n" +
    "```tool_call\n{\"name\":\"<tên>\",\"input\":{...}}\n```\n" +
    "Hệ thống sẽ chạy và gửi lại [Kết quả công cụ]; tiếp tục gọi tool nếu cần, hoặc " +
    "trả lời người dùng bằng văn bản thường. Nếu không cần công cụ, trả lời bình thường."
  );
}

/** Parse khối ```tool_call (hoặc JSON {name,input}) từ text model. */
function parseToolCall(text) {
  let jsonStr = null;
  const fenced = text.match(/```(?:tool_call|json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) jsonStr = fenced[1];
  else {
    const m = text.match(/\{[\s\S]*?"name"[\s\S]*?"input"[\s\S]*?\}/);
    if (m) jsonStr = m[0];
  }
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    if (obj && typeof obj.name === "string" && obj.input && typeof obj.input === "object") {
      return obj;
    }
  } catch {
    /* không phải JSON hợp lệ */
  }
  return null;
}

function runClaude(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_CMD, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`claude exited ${code}: ${stderr || stdout}`));
    });
    if (stdin) { child.stdin.write(stdin); child.stdin.end(); }
    else child.stdin.end();
  });
}

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  // ===== Health check =====
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, cmd: CLAUDE_CMD, configDir: CONFIG_DIR }));
  }

  // ===== Config storage: GET / POST / DELETE /config/:key =====
  if (req.url?.startsWith("/config/")) {
    const key = req.url.slice("/config/".length).split("?")[0];
    try {
      safeKey(key);
      const filePath = resolve(CONFIG_DIR, key + ".json");
      if (req.method === "GET") {
        try {
          const data = await fs.readFile(filePath, "utf8");
          res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
          return res.end(data);
        } catch (e) {
          if (e.code === "ENOENT") {
            res.writeHead(404, { ...corsHeaders, "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Not found", key }));
          }
          throw e;
        }
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        await fs.writeFile(filePath, JSON.stringify(body, null, 2), "utf8");
        console.log(`[bridge] config:${key} saved (${JSON.stringify(body).length} bytes)`);
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, key, savedAt: new Date().toISOString() }));
      }
      if (req.method === "DELETE") {
        await fs.unlink(filePath).catch(() => {});
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, key, deleted: true }));
      }
    } catch (e) {
      res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // ===== Models list: GET /models[?refresh=1] =====
  if (req.method === "GET" && req.url?.startsWith("/models")) {
    const refresh = req.url.includes("refresh=1");

    // 1. Env override luôn ưu tiên
    if (process.env.BRIDGE_MODELS) {
      const models = process.env.BRIDGE_MODELS.split(",").map((s) => s.trim()).filter(Boolean);
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models, source: "env" }));
    }

    // 2. Cache (24h) — bỏ qua nếu refresh=1
    if (!refresh) {
      const cached = await readModelsCache();
      if (cached) {
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        return res.end(JSON.stringify({ models: cached, source: "cache" }));
      }
    }

    // 3. Spawn `claude -p` để hỏi
    try {
      console.log(`[bridge] /models: querying CLI...`);
      const models = await listModelsViaCli();
      await writeModelsCache(models);
      console.log(`[bridge] /models: got ${models.length} from CLI:`, models.join(","));
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models, source: "cli" }));
    } catch (e) {
      console.warn(`[bridge] /models: CLI fail (${e.message}) → fallback hardcoded`);
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        models: HARDCODED_MODELS,
        source: "fallback",
        error: e.message,
      }));
    }
  }

  // ===== List all configs: GET /configs =====
  if (req.method === "GET" && req.url === "/configs") {
    try {
      const files = await fs.readdir(CONFIG_DIR);
      const list = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ keys: list, dir: CONFIG_DIR }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // ===== Claude CLI proxy: POST /v1/messages =====
  if (req.method === "POST" && req.url === "/v1/messages") {
    try {
      const body = await readBody(req);
      const messages = body.messages || [];
      if (!messages.length) throw new Error("No messages");

      // Render lịch sử (gồm cả tool_use / tool_result block) thành text prompt.
      let prompt = messages.map((m) => `[${m.role}] ${renderContent(m.content)}`).join("\n\n");
      const sys = (body.system || "") + buildToolInstructions(body.tools);
      if (sys.trim()) prompt = `[system] ${sys}\n\n${prompt}`;

      const args = ["-p", "--output-format=json"];
      if (body.model) args.push("--model", body.model);
      args.push(prompt);

      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      console.log(
        `[bridge] /v1/messages: spawn ${CLAUDE_CMD} (model=${body.model || "default"}, tools=${hasTools ? body.tools.length : 0})`,
      );
      const { stdout: out } = await runClaude(args);
      let parsed;
      try { parsed = JSON.parse(out); } catch { parsed = { result: out }; }
      const text = parsed.result || parsed.text || out;

      // Có tools + model xuất tool_call → trả Anthropic tool_use block.
      const toolCall = hasTools ? parseToolCall(text) : null;
      const content = toolCall
        ? [
            {
              type: "tool_use",
              id: "toolu_" + Date.now().toString(36) + Math.floor(performance.now()).toString(36),
              name: toolCall.name,
              input: toolCall.input,
            },
          ]
        : [{ type: "text", text }];

      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        id: "msg_" + Date.now(),
        type: "message",
        role: "assistant",
        content,
        model: body.model || "claude-cli",
        stop_reason: toolCall ? "tool_use" : "end_turn",
        usage: parsed.usage || { input_tokens: 0, output_tokens: 0 },
      }));
    } catch (e) {
      console.error("[bridge] /v1/messages fail:", e.message);
      res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: e.message } }));
    }
  }

  // ===== 404 fallback =====
  res.writeHead(404, corsHeaders);
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║   Claude Bridge + Config Server                   ║`);
  console.log(`║   http://localhost:${PORT}                            ║`);
  console.log(`║                                                  ║`);
  console.log(`║   Endpoints:                                     ║`);
  console.log(`║   - GET    /health                               ║`);
  console.log(`║   - GET    /models  (dynamic via claude -p, 24h cache) ║`);
  console.log(`║   - POST   /v1/messages  (Anthropic-compatible)  ║`);
  console.log(`\n[Claude Bridge + Config Server]`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Endpoints:`);
  console.log(`  - GET    /health`);
  console.log(`  - GET    /models  (dynamic via claude -p, 24h cache; ?refresh=1 to skip)`);
  console.log(`  - POST   /v1/messages  (Anthropic-compatible)`);
  console.log(`  - GET    /configs`);
  console.log(`  - GET    /config/:key`);
  console.log(`  - POST   /config/:key`);
  console.log(`  - DELETE /config/:key`);
  console.log(`  Bind: ${HOST}:${PORT}`);
  console.log(`  Config dir: ${CONFIG_DIR}`);
  console.log("");
});
