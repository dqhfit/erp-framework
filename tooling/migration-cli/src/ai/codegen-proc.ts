/* ==========================================================
   codegen-proc.ts — Pilot: port 1 stored proc MSSQL (tier D)
   sang file TS bằng Claude Agent SDK (agentic, nhiều bước).

   Phân tách trách nhiệm (an toàn):
   - CODE NÀY (ta kiểm soát) đụng MSSQL: fetch body + params qua
     MssqlClient, đọc manifest dựng mapping bảng→entity. Agent KHÔNG
     tự nối MSSQL.
   - AGENT (SDK query) làm phần coding: đọc file mẫu, viết file đích,
     (tuỳ chọn) chạy typecheck + sửa lặp. Bị `canUseTool` chặn cứng:
       · Read/Glob/Grep: cho phép (chỉ đọc).
       · Write/Edit: CHỈ trong packages/plugins/module-<module>/ (so khớp
         realpath + separator, chống sibling-prefix & symlink escape).
       · Bash: CHỈ lệnh typecheck ở env MIGRATION_CODEGEN_TYPECHECK (cho
         kèm arg sau dấu cách, nhưng REJECT mọi shell-metachar
         ; & | ` $ > < newline → chống chaining). Trống = chặn hết Bash.
       · Còn lại: chặn.

   KHÔNG đụng packages/server runtime. KHÔNG auto-commit.

   LLM auth: KHÔNG dùng ANTHROPIC_API_KEY. Agent SDK spawn Claude Code CLI
   và trỏ ANTHROPIC_BASE_URL về bridge cục bộ (BRIDGE_URL hoặc
   http://localhost:8909) — bridge tự auth qua phiên Claude Code local
   (giống adapter "claude-cli" của llm-client/llm-json). Không cần key thật.
   ========================================================== */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, PermissionResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { MssqlClient } from "@erp-framework/mssql-client";
import { readManifest, type Manifest, type ManifestProc } from "../manifest.js";
import { loadPrompt } from "./llm-client.js";

export interface CodegenProcOptions {
  module: string;
  /** Tên proc cần port — "schema.proc" hoặc tên ngắn. */
  proc: string;
  /** Trần số vòng agentic. Mặc định 30. */
  maxTurns?: number;
  /** Model override. Mặc định claude-opus-4-8 (hoặc env MIGRATION_CODEGEN_MODEL). */
  model?: string;
}

const DEFAULT_MODEL = "claude-opus-4-8";

/** Dò ngược từ cwd lên gốc repo (thư mục có pnpm-workspace.yaml). */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Không tìm thấy gốc repo (pnpm-workspace.yaml) từ cwd ngược lên.");
}

function procShortName(full: string): string {
  return full.split(".").pop() ?? full;
}

function sameTable(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Tìm proc trong manifest theo full name hoặc tên ngắn. */
function findProc(m: Manifest, procArg: string): ManifestProc {
  const hit =
    m.procs.find((p) => sameTable(p.name, procArg)) ??
    m.procs.find((p) => sameTable(procShortName(p.name), procShortName(procArg)));
  if (!hit) {
    throw new Error(
      `Không tìm thấy proc "${procArg}" trong manifest module "${m.module}". ` +
        `Có sẵn: ${m.procs.map((p) => p.name).join(", ")}`,
    );
  }
  return hit;
}

/** Dựng bảng markdown mapping bảng MSSQL → entity + field cho các bảng proc đụng. */
function buildMappingDoc(m: Manifest, proc: ManifestProc): string {
  const touched = new Set([...proc.reads, ...proc.writes].map((t) => t.toLowerCase()));
  const tables = m.tables.filter((t) => touched.has(t.name.toLowerCase()));
  // Nếu manifest reads/writes rỗng (parse thiếu), fallback toàn bộ bảng module.
  const list = tables.length > 0 ? tables : m.tables;
  if (list.length === 0) return "(Manifest không có bảng nào — agent phải suy từ T-SQL.)";

  return list
    .map((t) => {
      const entity =
        t.suggestedKind === "enum" ? `${t.suggestedEntityName} (ENUM)` : t.suggestedEntityName;
      // HYBRID: bảng thật PG (storageTier=table trong manifest) — agent query
      // TRỰC TIẾP bảng vật lý (cột typed cùng tên field), KHÔNG entity_records.
      const tier = (t as { storageTier?: string; physicalTable?: string }).storageTier;
      const phys = (t as { physicalTable?: string }).physicalTable ?? t.suggestedEntityName;
      const rows = t.columns
        .map((c) => {
          const field = c.mapTo?.field ?? "(chưa map — suy từ tên cột)";
          const pk = t.primaryKey.includes(c.name) ? " [PK]" : "";
          return `| ${c.name}${pk} | ${field} | ${c.type} |`;
        })
        .join("\n");
      const header =
        tier === "table"
          ? `### Bảng MSSQL \`${t.name}\` → **BẢNG THẬT PostgreSQL \`${phys}\`** (⚠ cột vật lý KHÔNG trùng tên field: cột prefix f_ hoặc nằm trong ext jsonb — BẮT BUỘC truy cập qua helper procTable với TÊN FIELD ở cột 2, case-sensitive)\n| Cột MSSQL | Field entity (dùng với procTable) | Kiểu |`
          : `### Bảng MSSQL \`${t.name}\` → entity \`${entity}\` (EAV)\n| Cột MSSQL | Field entity (data->>) | Kiểu |`;
      return `${header}\n|---|---|---|\n${rows}`;
    })
    .join("\n\n");
}

/** Guard quyết định tool nào agent được dùng. */
function makeGuard(moduleDir: string, typecheckPrefix: string | null): CanUseTool {
  // realpath boundary để chống symlink escape (vd 1 ancestor là symlink).
  const realModuleDir = existsSync(moduleDir) ? realpathSync(moduleDir) : resolve(moduleDir);
  return async (toolName, input): Promise<PermissionResult> => {
    if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
      return { behavior: "allow", updatedInput: input };
    }
    if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
      const raw = String(input.file_path ?? input.path ?? "");
      const abs = resolve(raw);
      // realpath nếu file đã tồn tại (chống ghi qua symlink trỏ ra ngoài). File
      // đích chưa tồn tại thì dùng abs — agent không có khả năng tạo symlink.
      const real = existsSync(abs) ? realpathSync(abs) : abs;
      // PHẢI dùng moduleDir + sep: nếu không "module-sales-evil" sẽ khớp prefix
      // "module-sales". Cho phép chính moduleDir hoặc con thật của nó.
      if (real === realModuleDir || real.startsWith(realModuleDir + sep)) {
        return { behavior: "allow", updatedInput: input };
      }
      return {
        behavior: "deny",
        message: `Chỉ được ghi trong ${realModuleDir}. Bị chặn: ${real}`,
      };
    }
    if (toolName === "Bash") {
      const cmd = String(input.command ?? "").trim();
      // Chỉ cho phép đúng lệnh typecheck (hoặc kèm arg sau dấu cách). Chặn mọi
      // shell-chaining/redirect (; & | ` $ > < newline) — nếu không
      // "<prefix>; rm -rf" sẽ vượt qua check startsWith.
      if (typecheckPrefix) {
        const exact = cmd === typecheckPrefix;
        const withArgs = cmd.startsWith(`${typecheckPrefix} `);
        const hasShellMeta = /[;&|`$><\n]/.test(cmd);
        if ((exact || withArgs) && !hasShellMeta) {
          return { behavior: "allow", updatedInput: input };
        }
      }
      return {
        behavior: "deny",
        message: typecheckPrefix
          ? `Bash chỉ cho phép đúng lệnh typecheck "${typecheckPrefix}" (không chaining). Bị chặn: ${cmd}`
          : `Bash bị chặn (đặt env MIGRATION_CODEGEN_TYPECHECK để bật lệnh typecheck). Bị chặn: ${cmd}`,
      };
    }
    return { behavior: "deny", message: `Tool ${toolName} không được phép trong codegen-proc.` };
  };
}

export async function runCodegenProc(
  opts: CodegenProcOptions,
): Promise<{ filePath: string; costUsd: number; numTurns: number }> {
  // KHÔNG cần ANTHROPIC_API_KEY — route qua bridge cục bộ. Cùng cách resolve
  // như llm-json/llm-client: BRIDGE_URL (Docker: http://bridge:8909) hoặc
  // http://localhost:8909 (dev chạy ngoài Docker).
  const bridgeUrl = (process.env.BRIDGE_URL || "http://localhost:8909").replace(/\/$/, "");

  const repoRoot = findRepoRoot();
  const m = readManifest(opts.module);
  const proc = findProc(m, opts.proc);
  if (proc.suggestedTier !== "D") {
    throw new Error(
      `Proc "${proc.name}" có tier ${proc.suggestedTier}, không phải D. ` +
        `codegen-proc pilot chỉ hỗ trợ tier D.`,
    );
  }

  // --- Phần đụng MSSQL: ta kiểm soát, agent không tự nối. ---
  const parts = proc.name.split(".");
  const procSchema = parts.length > 1 ? (parts[0] ?? "dbo") : "dbo";
  const bareName = (parts.length > 1 ? parts.slice(1).join(".") : parts[0]) ?? proc.name;
  const mssql = MssqlClient.fromEnv();
  await mssql.connect();
  let procBody: string;
  let procParams: string;
  try {
    const info = await mssql.getProc(procSchema, bareName);
    if (!info) {
      throw new Error(`Không đọc được proc ${procSchema}.${bareName} từ MSSQL.`);
    }
    procBody = info.body;
    procParams =
      info.parameters.length > 0
        ? info.parameters
            .map(
              (p) =>
                `${p.name} ${p.dataType}${p.isOutput ? " OUTPUT" : ""}${p.hasDefault ? " (có default)" : ""}`,
            )
            .join("\n")
        : "(không có tham số)";
  } finally {
    await mssql.close();
  }

  // --- Dựng đường dẫn file đích + context ---
  const moduleDir = resolve(repoRoot, "packages", "plugins", `module-${m.module}`);
  const fileName = proc.targetFile ?? `${procShortName(proc.name).toLowerCase()}.ts`;
  const targetPath = resolve(moduleDir, fileName);
  // Mẫu bảng thật (procTable) + mẫu EAV — agent đọc theo tier trong mapping.
  const exampleRel = [
    "packages/plugins/module-ui_procs/tr_dondathang_insert2.ts (bảng thật — INSERT qua procTable)",
    "packages/plugins/module-ui_procs/tr_order_islock.ts (bảng thật — SELECT + field ext)",
    "packages/plugins/module-sales/lay_cap_phat_vat_tu_govan_theo_sp.ts (EAV)",
  ].join("\n");

  const typecheckPrefix = process.env.MIGRATION_CODEGEN_TYPECHECK?.trim() || null;
  const mapping = buildMappingDoc(m, proc);

  const userPrompt = [
    `# Port proc tier D: \`${proc.name}\``,
    proc.label ? `Nhãn: ${proc.label}` : "",
    proc.description ? `Mô tả nghiệp vụ: ${proc.description}` : "",
    proc.businessCategory ? `Loại nghiệp vụ (AI phân loại): ${proc.businessCategory}` : "",
    "",
    `## File đích (BẮT BUỘC ghi đúng path này)`,
    targetPath,
    "",
    `## File mẫu vàng (ĐỌC trước để học pattern)`,
    exampleRel,
    "",
    `## Tham số proc (MSSQL)`,
    "```",
    procParams,
    "```",
    "",
    `## Mapping bảng MSSQL → entity (data jsonb)`,
    mapping,
    "",
    `## Body T-SQL nguồn`,
    "```sql",
    procBody,
    "```",
    "",
    typecheckPrefix
      ? `## Typecheck\nSau khi viết file, chạy: \`${typecheckPrefix}\` rồi sửa cho tới khi sạch.`
      : `## Typecheck\nKHÔNG có lệnh typecheck được cấp. Viết file xong thì dừng và tóm tắt điểm cần con người review.`,
  ]
    .filter(Boolean)
    .join("\n");

  console.log(`▸ codegen-proc: ${proc.name} → ${targetPath}`);
  console.log(`  Repo root: ${repoRoot}`);
  console.log(`  LLM: bridge ${bridgeUrl} (Claude Code CLI, không cần API key)`);
  console.log(`  Model: ${opts.model ?? process.env.MIGRATION_CODEGEN_MODEL ?? DEFAULT_MODEL}`);
  console.log(
    `  maxTurns: ${opts.maxTurns ?? 30}  | Bash typecheck: ${typecheckPrefix ?? "(tắt)"}`,
  );
  console.log("");

  const transcript: Array<Record<string, unknown>> = [];
  let costUsd = 0;
  let numTurns = 0;
  let resultText = "";

  const stream = query({
    prompt: userPrompt,
    options: {
      cwd: repoRoot,
      model: opts.model ?? process.env.MIGRATION_CODEGEN_MODEL ?? DEFAULT_MODEL,
      maxTurns: opts.maxTurns ?? 30,
      systemPrompt: { type: "preset", preset: "claude_code", append: loadPrompt("codegen-proc") },
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      permissionMode: "default",
      canUseTool: makeGuard(moduleDir, typecheckPrefix),
      // env REPLACE toàn bộ env subprocess (theo doc SDK) → phải spread
      // process.env để giữ PATH/HOME. Trỏ CLI về bridge, không cần key thật;
      // placeholder ANTHROPIC_API_KEY để CLI chạy API-mode (bridge bỏ qua key).
      // MIGRATION_CODEGEN_DIRECT=1: bỏ qua bridge, dùng thẳng claude CLI local
      // (login Pro/Max trên máy dev) — khi bridge container thiếu model/auth cũ.
      env:
        process.env.MIGRATION_CODEGEN_DIRECT === "1"
          ? { ...process.env }
          : {
              ...process.env,
              ANTHROPIC_BASE_URL: bridgeUrl,
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "bridge",
            },
    },
  });

  for await (const msg of stream as AsyncIterable<SDKMessage>) {
    if (msg.type === "assistant") {
      const content = (msg.message.content ?? []) as unknown as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          process.stdout.write(block.text);
          transcript.push({ kind: "text", text: block.text });
        } else if (block.type === "tool_use") {
          const name = String(block.name);
          console.log(`\n  [tool] ${name}`);
          transcript.push({ kind: "tool_use", name, input: block.input });
        }
      }
    } else if (msg.type === "result") {
      costUsd = msg.total_cost_usd ?? 0;
      numTurns = msg.num_turns ?? 0;
      resultText =
        msg.subtype === "success"
          ? msg.result
          : `[${msg.subtype}] ${(msg.errors ?? []).join("; ")}`;
      transcript.push({ kind: "result", subtype: msg.subtype, costUsd, numTurns });
    }
  }

  // --- Audit log (cùng pattern callAi) ---
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = resolve(
    repoRoot,
    "migration-plan",
    "ai-log",
    m.module,
    `codegen-proc-${ts}.json`,
  );
  if (!existsSync(dirname(logPath))) mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        module: m.module,
        proc: proc.name,
        targetPath,
        model: opts.model ?? process.env.MIGRATION_CODEGEN_MODEL ?? DEFAULT_MODEL,
        costUsd,
        numTurns,
        result: resultText,
        transcript,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("\n");
  const wrote = existsSync(targetPath);
  console.log(`▸ ${wrote ? "✓ Đã ghi" : "✗ CHƯA thấy"} file: ${targetPath}`);
  console.log(`▸ Cost: $${costUsd.toFixed(4)}  |  Turns: ${numTurns}  |  Log: ${logPath}`);
  console.log(
    `▸ Review bằng:  git diff -- ${targetPath.replace(repoRoot + "\\", "").replace(repoRoot + "/", "")}`,
  );
  console.log(`  (KHÔNG auto-commit — kiểm tra logic + so với bản port tay trước khi giữ.)`);

  return { filePath: targetPath, costUsd, numTurns };
}
