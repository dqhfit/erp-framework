#!/usr/bin/env tsx
/* ==========================================================
   migration-cli — `pnpm migrate <subcommand>` entry.
   Subcommand:
     discover       Sinh manifest YAML từ seed table + BFS qua proc
     capture-golden Gọi proc MSSQL với sample input, lưu output baseline
     generate       Sinh skeleton entity/page/procedure từ manifest
     data           ETL bulk-read từ MSSQL vào entity_records
   ========================================================== */

import { parseArgs } from "node:util";
import { runDiscover } from "./discover.js";
import { runCaptureGolden } from "./capture-golden.js";
import { runGenerate } from "./generate.js";
import { runData } from "./data.js";
import { runEnrich } from "./ai/enrich.js";
import { runCodegenProc } from "./ai/codegen-proc.js";

const HELP = `
Dùng:
  pnpm migrate <subcommand> [options]

Subcommand:
  discover       --name <module> --seed-tables T1,T2 [--exclude-tables X,Y]
                 [--max-tables 30] [--out migration-plan/modules/<name>.yaml]

  enrich         --module <module> [--apply] [--max-cost-usd 5] [--skip-enriched]
                 AI Tier 1: tên Việt + label + tier override + description.

  codegen-proc   --module <module> --proc <schema.proc> [--max-turns 30] [--model <id>]
                 PILOT: port 1 stored-proc tier D (MSSQL) sang file TS bằng
                 Claude Agent SDK. Agent viết packages/plugins/module-<m>/.
                 Chỉ ghi file để review (git diff), KHÔNG auto-commit.

  capture-golden --module <module> [--samples 10]

  generate       --module <module> [--dry-run]

  data           --module <module> [--table T] [--limit 10000]

Env cần đặt:
  MSSQL_CONNECTION_STRING   Connection string MSSQL (read-only mặc định)
  MSSQL_ALLOW_WRITE=1       Cho phép execProc (chỉ bật khi capture golden)
  DATABASE_URL              Connection string PG của framework
  MIGRATION_COMPANY_ID      Company UUID target (default: company đầu tiên)
  ANTHROPIC_API_KEY         Key dev local — bắt buộc cho codegen-proc
  MIGRATION_CODEGEN_MODEL   Model override cho codegen-proc (default claude-opus-4-8)
  MIGRATION_CODEGEN_TYPECHECK  Prefix lệnh typecheck agent được phép chạy
                            (trống = chặn Bash, agent chỉ viết file)

Ví dụ:
  pnpm migrate discover --name sales --seed-tables dbo.Orders,dbo.OrderItems
  pnpm migrate enrich --module sales --apply
  pnpm migrate capture-golden --module sales --samples 5
  pnpm migrate codegen-proc --module sales --proc dbo.Lay_DonHang
`.trim();

async function main(): Promise<void> {
  // pnpm chèn "--" giữa script và args khi user dùng "pnpm migrate ...".
  // Loại bỏ "--" hàng đầu để subcommand lấy đúng vị trí.
  const rawArgs = process.argv.slice(2).filter((a) => a !== "--");
  const sub = rawArgs[0];
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return;
  }

  const argv = rawArgs.slice(1);

  try {
    switch (sub) {
      case "discover": {
        const { values } = parseArgs({
          args: argv,
          strict: true,
          options: {
            name: { type: "string" },
            "seed-tables": { type: "string" },
            "exclude-tables": { type: "string" },
            "max-tables": { type: "string" },
            out: { type: "string" },
          },
        });
        if (!values.name || !values["seed-tables"]) {
          throw new Error("discover: thiếu --name hoặc --seed-tables");
        }
        await runDiscover({
          name: values.name,
          seedTables: values["seed-tables"]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          excludeTables: (values["exclude-tables"] ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          maxTables: values["max-tables"] ? parseInt(values["max-tables"], 10) : 30,
          out: values.out,
        });
        break;
      }
      case "enrich": {
        const { values } = parseArgs({
          args: argv,
          strict: true,
          options: {
            module: { type: "string" },
            apply: { type: "boolean", default: false },
            "max-cost-usd": { type: "string" },
            "skip-enriched": { type: "boolean", default: false },
            "only-procs": { type: "string" }, // comma-sep, dry-run 1 hoặc vài proc
          },
        });
        if (!values.module) throw new Error("enrich: thiếu --module");
        await runEnrich({
          module: values.module,
          apply: values.apply === true,
          maxCostUsd: values["max-cost-usd"] ? parseFloat(values["max-cost-usd"]) : 5,
          skipEnriched: values["skip-enriched"] === true,
          onlyProcs: values["only-procs"]
            ? values["only-procs"]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        });
        break;
      }
      case "codegen-proc": {
        const { values } = parseArgs({
          args: argv,
          strict: true,
          options: {
            module: { type: "string" },
            proc: { type: "string" },
            "max-turns": { type: "string" },
            model: { type: "string" },
          },
        });
        if (!values.module || !values.proc) {
          throw new Error("codegen-proc: thiếu --module hoặc --proc");
        }
        await runCodegenProc({
          module: values.module,
          proc: values.proc,
          maxTurns: values["max-turns"] ? parseInt(values["max-turns"], 10) : 30,
          model: values.model,
        });
        break;
      }
      case "capture-golden": {
        const { values } = parseArgs({
          args: argv,
          strict: true,
          options: {
            module: { type: "string" },
            samples: { type: "string" },
          },
        });
        if (!values.module) throw new Error("capture-golden: thiếu --module");
        await runCaptureGolden({
          module: values.module,
          samples: values.samples ? parseInt(values.samples, 10) : 10,
        });
        break;
      }
      case "generate": {
        const { values } = parseArgs({
          args: argv,
          strict: true,
          options: {
            module: { type: "string" },
            "dry-run": { type: "boolean", default: false },
          },
        });
        if (!values.module) throw new Error("generate: thiếu --module");
        await runGenerate({ module: values.module, dryRun: values["dry-run"] === true });
        break;
      }
      case "data": {
        const { values } = parseArgs({
          args: argv,
          strict: true,
          options: {
            module: { type: "string" },
            table: { type: "string" }, // back-compat single
            tables: { type: "string" }, // mới, comma-sep
            limit: { type: "string" },
          },
        });
        if (!values.module) throw new Error("data: thiếu --module");
        await runData({
          module: values.module,
          table: values.table,
          tables: values.tables
            ? values.tables
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          limit: values.limit ? parseInt(values.limit, 10) : 10_000,
        });
        break;
      }
      default:
        console.error(`Subcommand không hỗ trợ: ${sub}\n`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }
}

void main();
