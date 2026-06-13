/* Theo dõi N full-import job qua MCP — in 1 dòng khi job đổi trạng thái
   hoặc thêm bảng xong; thoát khi TẤT CẢ job terminal. Node thuần (mjs),
   key đọc từ ~/.claude.json. Dùng cho Monitor (mỗi dòng stdout = 1 event). */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const jobIds = process.argv.slice(2);
if (jobIds.length === 0) {
  console.error("Cần danh sách jobId");
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
const KEY =
  cfg.projects["D:/code/cowok/Apps/erp-framework"].mcpServers["erp-feedback"].headers["X-API-Key"];
const URL = "https://erp.vfmgroup.vn/mcp/migration";
const TERMINAL = new Set(["completed", "failed", "paused", "canceled"]);

let rpc = 0;
async function getJob(jobId) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpc,
      method: "tools/call",
      params: { name: "migration_get_full_job", arguments: { jobId } },
    }),
  });
  const j = await res.json();
  const o = JSON.parse(j.result?.content?.[0]?.text ?? "{}");
  const tables = o.tables ?? [];
  return {
    status: o.job?.status ?? "?",
    done: tables.filter((t) => t.status === "done").length,
    failed: tables.filter((t) => t.status === "failed").length,
    total: tables.length,
    rows: tables.reduce((s, t) => s + Number(t.rowsImported ?? 0), 0),
  };
}

const last = new Map();
for (;;) {
  let allTerminal = true;
  for (const id of jobIds) {
    try {
      const s = await getJob(id);
      const key = `${s.status}:${s.done}:${s.failed}`;
      const short = id.slice(-6);
      if (last.get(id) !== key) {
        last.set(id, key);
        console.log(
          `job ${short}: ${s.status} — ${s.done}/${s.total} bảng xong${s.failed ? `, ${s.failed} FAILED` : ""} (${s.rows} rows)`,
        );
      }
      if (!TERMINAL.has(s.status)) allTerminal = false;
    } catch (e) {
      // lỗi mạng thoáng qua — thử lại chu kỳ sau, không giết monitor
      allTerminal = false;
    }
  }
  if (allTerminal) {
    console.log("ALL_JOBS_TERMINAL");
    break;
  }
  await new Promise((r) => setTimeout(r, 60_000));
}
