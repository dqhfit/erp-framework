/* ==========================================================
   apply-wiring.mts — Áp wiring per-page từ wiring-proposal.json qua MCP
   page_wire_datasource (set dataSourceId + setFields theo grid DQHF).

   LỌC an toàn (mặc định): chỉ áp proposal matchType="title" (khớp tiêu đề
   form, tin cậy) VÀ setFields >= MIN_COLS (giàu cột — thêm cột join thật,
   tránh trường hợp grid∩projection mỏng làm GIẢM cột). setFields THAY TRỌN
   fields[] nên ngưỡng cột bảo vệ khỏi mất cột.

   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/apply-wiring.mts [--apply] [--min N]
   Mặc định dryRun. --apply để ghi thật. --min đổi ngưỡng cột (mặc định 6).
   ========================================================== */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) {
  console.error("Thiếu MIGRATION_MCP_KEY");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");
const minIdx = process.argv.indexOf("--min");
const MIN_COLS = minIdx >= 0 ? Number(process.argv[minIdx + 1]) : 6;

let rpc = 0;
async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpc,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const j = (await res.json()) as {
    error?: { message: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  if (j.error || j.result?.isError) {
    throw new Error(j.error?.message ?? j.result?.content?.[0]?.text ?? "mcp error");
  }
  return JSON.parse(j.result?.content?.[0]?.text ?? "null") as T;
}

interface Prop {
  page: string;
  title: string;
  dataSource: string;
  fromForm: string;
  matchType: "title" | "fallback";
  setFields: string[];
  columnLabels?: Record<string, string>;
}

async function main() {
  const { proposal } = JSON.parse(
    readFileSync(join(ERP_ROOT, "migration-plan/ui/wiring-proposal.json"), "utf8"),
  ) as { proposal: Prop[] };

  const targets = proposal.filter(
    (p) => p.matchType === "title" && p.setFields.length >= MIN_COLS,
  );
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} | ngưỡng ${MIN_COLS} cột | ${targets.length}/${proposal.length} page đạt\n`,
  );

  let ok = 0;
  let changedWidgets = 0;
  const errors: string[] = [];
  for (const t of targets) {
    try {
      const r = await mcp<{ pagesChanged: number; widgetsChanged: number; skippedPublished: string[] }>(
        "page_wire_datasource",
        {
          dataSourceName: t.dataSource,
          pageNames: [t.page],
          setFields: t.setFields,
          ...(t.columnLabels && Object.keys(t.columnLabels).length
            ? { columnLabels: t.columnLabels }
            : {}),
          dryRun: !APPLY,
        },
      );
      changedWidgets += r.widgetsChanged;
      if (r.pagesChanged > 0) ok++;
      const note = r.skippedPublished.length ? ` (skip published: ${r.skippedPublished.join(",")})` : "";
      console.log(`  ${t.page} → ${t.dataSource} [${t.setFields.length} cột] pages=${r.pagesChanged}${note}`);
    } catch (e) {
      errors.push(`${t.page}: ${(e as Error).message}`);
      console.log(`  ✗ ${t.page}: ${(e as Error).message}`);
    }
  }
  console.log(`\n${APPLY ? "Đã ghi" : "Sẽ ghi"}: ${ok} page, ${changedWidgets} widget. Lỗi: ${errors.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
