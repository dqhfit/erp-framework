/* ==========================================================
   capture-golden.ts — Gọi proc MSSQL với sample input, lưu
   output baseline vào e2e/golden/<module>/<proc>.json.

   Hiện tại: scaffold — yêu cầu user đặt MSSQL_ALLOW_WRITE=1
   (vì execProc mặc định bị chặn), và cung cấp sample input qua
   file YAML cho mỗi proc. Logic auto-pick input sẽ thêm sau khi
   có module đầu tiên chạy thực tế.
   ========================================================== */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { MssqlClient } from "@erp-framework/mssql-client";
import { readManifest } from "./manifest.js";

export interface CaptureGoldenOptions {
  module: string;
  samples: number;
  /** Inject client từ worker. CLI standalone sẽ dùng fromEnv(). */
  mssqlClient?: MssqlClient;
}

export async function runCaptureGolden(opts: CaptureGoldenOptions): Promise<void> {
  const m = readManifest(opts.module);
  console.log(`▸ Capture golden cho module "${opts.module}" — ${m.procs.length} proc`);

  // Khi worker inject client → tin tưởng connection đã có allowWrite từ DB.
  // Khi CLI standalone → require env MSSQL_ALLOW_WRITE=1.
  if (!opts.mssqlClient && process.env.MSSQL_ALLOW_WRITE !== "1") {
    console.error(
      "✗ execProc bị chặn ở read-only mode.\n" +
        "  Bật tạm thời: MSSQL_ALLOW_WRITE=1 pnpm migrate capture-golden ...\n" +
        "  Hoặc dùng UI: thêm connection có toggle 'Allow write' = true.",
    );
    process.exit(1);
  }

  const sampleInputFile = resolve(
    process.cwd(),
    "migration-plan",
    "samples",
    `${opts.module}.yaml`,
  );
  if (!existsSync(sampleInputFile)) {
    console.warn(
      `! Không tìm thấy sample input: ${sampleInputFile}\n` +
        `  Tạo file này theo cấu trúc:\n` +
        `    dbo.sp_GetOrder:\n` +
        `      - { OrderId: 1 }\n` +
        `      - { OrderId: 2 }\n` +
        `    dbo.sp_UpdateOrderStatus:\n` +
        `      - { OrderId: 1, Status: 'done' }\n`,
    );
    console.warn(`! Bỏ qua capture-golden — chưa có sample input.`);
    return;
  }

  const ownedClient = !opts.mssqlClient;
  const client = opts.mssqlClient ?? MssqlClient.fromEnv();
  if (ownedClient) await client.connect();
  try {
    // TODO: đọc sample YAML, chạy execProc với từng input, lưu output.
    // Chưa implement vì cần quyết định định dạng sample input cuối cùng
    // sau khi có module thực tế (vài sample edge-case sẽ phát sinh).
    console.log(
      `▸ TODO: implement capture-golden với sample input ${sampleInputFile}.\n` +
        `  Gợi ý: foreach proc → client.execProc(proc.name, sample) → JSON.stringify\n` +
        `  → ghi vào e2e/golden/${opts.module}/<proc>.json`,
    );
    void opts.samples;

    // Tạo thư mục rỗng để cấu trúc có sẵn.
    const goldenDir = resolve(process.cwd(), "e2e", "golden", opts.module);
    if (!existsSync(goldenDir)) mkdirSync(goldenDir, { recursive: true });
    const placeholder = resolve(goldenDir, ".gitkeep");
    if (!existsSync(placeholder)) writeFileSync(placeholder, "", "utf8");
    void dirname;
  } finally {
    if (ownedClient) await client.close();
  }
}
