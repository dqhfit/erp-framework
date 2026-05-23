/* ==========================================================
   agent-memory.ts — Bộ nhớ "markdown files" cho mỗi agent.
   Giống paperclip/openclaw: 7 file cố định nhúng vào system
   prompt mỗi lần agent chạy (chat hoặc heartbeat); agent có
   thể tự gọi tool memory_remember để append vào một file
   (vd ghi sở thích người dùng vào USER.md).
   Lưu trong agents.config.memory (jsonb) — không cần migration.
   ========================================================== */
import { eq } from "drizzle-orm";
import { agents } from "@erp-framework/db";
import { db } from "./db";

export const MEMORY_FILES = [
  "IDENTITY", "SOUL", "USER", "TOOLS", "AGENTS", "HEARTBEAT", "BOOTSTRAP",
] as const;
export type MemoryFile = typeof MEMORY_FILES[number];

/** Nhãn VI cho UI. */
export const MEMORY_LABEL: Record<MemoryFile, string> = {
  IDENTITY: "Danh tính",
  SOUL: "Tinh thần / Giá trị",
  USER: "Người dùng",
  TOOLS: "Công cụ",
  AGENTS: "Các agent khác",
  HEARTBEAT: "Nhịp đập",
  BOOTSTRAP: "Khởi động",
};

/** Template mặc định — agent không có memory custom vẫn có ngữ cảnh. */
export function defaultTemplate(file: MemoryFile, agentName = "agent")
: string {
  switch (file) {
    case "IDENTITY":
      return `# ${agentName}\n\n` +
        `Tôi là **${agentName}** — trợ lý ERP của công ty.\n\n` +
        `Vai trò chính:\n` +
        `- Thực thi tác vụ người dùng giao thông qua MCP tools.\n` +
        `- Tự cập nhật file memory khi học được điều mới.\n`;
    case "SOUL":
      return `# Tinh thần\n\n` +
        `- Trả lời TIẾNG VIỆT, ngắn gọn, thân thiện.\n` +
        `- Trước khi tạo/sửa/xoá dữ liệu thật → XÁC NHẬN lại với người dùng.\n` +
        `- Tôn trọng RBAC: thử thao tác cấm → giải thích thay vì thử lén.\n` +
        `- Khi không chắc → hỏi lại thay vì đoán.\n` +
        `- Học được điều mới (sở thích người dùng, quy ước đội nhóm) → ghi vào memory thích hợp.\n`;
    case "USER":
      return `# Người dùng\n\n` +
        `(Chưa thu thập được thông tin nào.)\n\n` +
        `Mỗi khi phát hiện sở thích, vai trò, ngữ cảnh mới của người dùng → gọi:\n` +
        `\`memory_remember({ file: "USER", content: "..." })\`\n`;
    case "TOOLS":
      return `# Công cụ khả dụng\n\n` +
        `Danh sách tool động (MCP + server-side) được truyền vào mỗi vòng — không cần liệt kê tay ở đây.\n\n` +
        `Quy ước:\n` +
        `- \`knowledge_search\` — tra Knowledge Base trước khi đoán.\n` +
        `- \`knowledge_add\` — lưu câu trả lời hay vào tri thức.\n` +
        `- \`memory_remember\` — ghi nhớ vào memory của chính tôi.\n` +
        `- Tool MCP entity (list/get/save/delete) — thao tác dữ liệu thật.\n`;
    case "AGENTS":
      return `# Các agent khác trong công ty\n\n` +
        `(Server tự cập nhật danh sách này khi đọc memory.)\n\n` +
        `Có thể tham chiếu hoặc đề xuất chuyển sang agent khác khi yêu cầu lệch chuyên môn.\n`;
    case "HEARTBEAT":
      return `# Nhịp đập (heartbeat)\n\n` +
        `Việc thường làm mỗi nhịp:\n` +
        `- Kiểm Knowledge Base có gì mới đáng tóm tắt không.\n` +
        `- Quét \`activity_log\` xem có yêu cầu pending.\n` +
        `- Cập nhật memory nếu thấy pattern lặp lại.\n\n` +
        `Lệnh cụ thể của nhịp này nằm trong message \`user\` (\`agent_heartbeats.prompt\`).\n`;
    case "BOOTSTRAP":
      return `# Khởi động phiên\n\n` +
        `Bắt đầu mỗi phiên (chat hoặc nhịp):\n` +
        `1. Đọc IDENTITY + SOUL — nhớ mình là ai, cư xử thế nào.\n` +
        `2. Liếc qua USER — biết người mình đang phục vụ.\n` +
        `3. Liếc TOOLS — biết mình có gì trong tay.\n` +
        `4. Đọc yêu cầu cụ thể từ người dùng/heartbeat → thực thi.\n`;
  }
}

export type MemoryRecord = Record<MemoryFile, string>;

/** Đọc agent từ DB, trả memory đã điền default cho key thiếu. */
export async function loadAgentMemory(
  agentId: string, agentName?: string,
): Promise<MemoryRecord> {
  const [a] = await db.select().from(agents).where(eq(agents.id, agentId));
  const cfg = (a?.config ?? {}) as { memory?: Partial<Record<MemoryFile, string>> };
  const stored = cfg.memory ?? {};
  const name = agentName ?? a?.name ?? "agent";
  const out = {} as MemoryRecord;
  for (const f of MEMORY_FILES) {
    out[f] = stored[f] && stored[f].trim() ? stored[f] : defaultTemplate(f, name);
  }
  return out;
}

/** Ghép 7 file thành chuỗi preamble cho system prompt. */
export function formatMemoryPreamble(memory: MemoryRecord): string {
  return MEMORY_FILES
    .map((f) => `=== ${f} ===\n${memory[f]}`)
    .join("\n\n");
}

/** Append nội dung mới vào một file memory + dấu thời gian. Atomic. */
export async function appendMemory(
  agentId: string, file: MemoryFile, content: string,
): Promise<void> {
  const [a] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!a) throw new Error("Agent không tồn tại.");
  const cfg = (a.config ?? {}) as {
    memory?: Partial<Record<MemoryFile, string>>;
    [k: string]: unknown;
  };
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const previous = cfg.memory?.[file]
    ?? defaultTemplate(file, a.name);
  const next = `${previous.trimEnd()}\n\n[${stamp}] ${content.trim()}\n`;
  const newMemory = { ...(cfg.memory ?? {}), [file]: next };
  await db.update(agents).set({
    config: { ...cfg, memory: newMemory },
    updatedAt: new Date(),
  }).where(eq(agents.id, agentId));
}

/** Bộ defaults cho UI (trả qua tRPC để UI khỏi nhúng hằng số). */
export function allDefaultTemplates(agentName: string)
: Record<MemoryFile, string> {
  const out = {} as Record<MemoryFile, string>;
  for (const f of MEMORY_FILES) out[f] = defaultTemplate(f, agentName);
  return out;
}
