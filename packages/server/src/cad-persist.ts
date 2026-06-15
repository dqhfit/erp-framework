/* ==========================================================
   cad-persist.ts — Lớp persist DÙNG CHUNG cho bản vẽ CAD do FreeCAD sinh.

   Cả 3 provider (1 sidecar in-app, 3 external máy trạm, 2b browser-local)
   đều gọi `persistDrawing` để: ghi file 2D (svg/html/pdf) + các artifact
   kèm (model.step, preview.png) vào BANVE_FILES_DIR theo công ty/masp, rồi
   chèn 1 record `tr_banve` (phanloai="Bản vẽ AI") qua proc Tier D
   `trBanveInsert3` (tự set tr_sanpham.isbvai = true).

   File 2D rơi đúng vào luồng tiêu thụ bản vẽ sẵn có: GET /banvesvc/file?id=
   stream theo f_filepath → trang mobile /banve tab "Bản vẽ AI".
   ========================================================== */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DB } from "./db";
import { getModuleProcByName } from "./module-procs";

/** Định dạng file 2D được phép lưu vào tr_banve.filepath. */
export type DrawingExt = "svg" | "html" | "pdf";
const DRAWING_EXTS: DrawingExt[] = ["svg", "html", "pdf"];

export interface CadArtifact {
  /** Đuôi file (không có dấu chấm). */
  ext: DrawingExt;
  /** Nội dung file mã hoá base64. */
  base64: string;
}

export interface PersistDrawingOpts {
  masp: string;
  /** File 2D chính — đi vào tr_banve.filepath + hiện ở /banve. */
  drawing: CadArtifact;
  /** Artifact phụ lưu kèm (vd model.step, preview.png) — KHÔNG vào tr_banve. */
  extras?: Array<{ name: string; base64: string }>;
  createdBy?: string | null;
  tensp?: string | null;
  hehang?: string | null;
  khachhang?: string | null;
}

export interface PersistDrawingResult {
  /** id record tr_banve. */
  id: string;
  /** Đường dẫn tương đối lưu trong tr_banve.f_filepath. */
  filepath: string;
  /** URL xem trực tiếp qua endpoint sẵn có. */
  url: string;
  /** Đường dẫn tương đối của các artifact phụ (step/png). */
  extras: Array<{ name: string; filepath: string }>;
}

/** Chỉ giữ ký tự an toàn cho 1 segment đường dẫn (chống traversal). */
function safeSegment(raw: string): string {
  const s = String(raw)
    .replace(/[\\/]+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 120);
  return s || "_";
}

/**
 * Ghi artifact + chèn record tr_banve. Trả id + url.
 * Ném lỗi rõ nếu BANVE_FILES_DIR chưa cấu hình (không có chỗ ghi file sinh ra).
 */
export async function persistDrawing(
  db: DB,
  companyId: string,
  opts: PersistDrawingOpts,
): Promise<PersistDrawingResult> {
  const masp = String(opts.masp ?? "").trim();
  if (!masp) throw new Error("Thiếu masp");
  if (!DRAWING_EXTS.includes(opts.drawing?.ext)) {
    throw new Error(`Định dạng bản vẽ không hợp lệ: ${opts.drawing?.ext}`);
  }
  if (!opts.drawing?.base64) throw new Error("Bản vẽ rỗng (thiếu nội dung base64).");

  const base = process.env.BANVE_FILES_DIR;
  if (!base) {
    throw new Error(
      "BANVE_FILES_DIR chưa cấu hình — không có nơi lưu bản vẽ CAD sinh ra. " +
        "Đặt biến môi trường BANVE_FILES_DIR trỏ tới thư mục ghi được.",
    );
  }

  const maspSafe = safeSegment(masp);
  const relDir = `${companyId}/${maspSafe}`;
  const absDir = join(base, companyId, maspSafe);
  await mkdir(absDir, { recursive: true });

  // 1 stamp chung cho cả lần gọi để gom file cùng bản vẽ.
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;

  // File 2D chính.
  const drawingName = `cad-${stamp}.${opts.drawing.ext}`;
  await writeFile(join(absDir, drawingName), Buffer.from(opts.drawing.base64, "base64"));
  const filepath = `${relDir}/${drawingName}`;

  // Artifact phụ (step/png…).
  const extras: Array<{ name: string; filepath: string }> = [];
  for (const ex of opts.extras ?? []) {
    if (!ex?.base64) continue;
    const nameSafe = safeSegment(ex.name || "artifact");
    const fileName = `cad-${stamp}-${nameSafe}`;
    await writeFile(join(absDir, fileName), Buffer.from(ex.base64, "base64"));
    extras.push({ name: ex.name, filepath: `${relDir}/${fileName}` });
  }

  // Chèn record qua proc Tier D (tự set tr_sanpham.isbvai). getModuleProcByName
  // khớp theo exportName "trBanveInsert3" (module-ui_procs auto-load).
  const proc = await getModuleProcByName("trBanveInsert3");
  if (!proc) {
    throw new Error(
      "Không tìm thấy proc trBanveInsert3 (module-ui_procs chưa nạp?). " +
        "Kiểm tra packages/plugins/module-ui_procs/tr_banve_insert3.ts.",
    );
  }
  const res = (await proc.fn(db, companyId, {
    masp,
    tensp: opts.tensp ?? null,
    hehang: opts.hehang ?? null,
    khachhang: opts.khachhang ?? null,
    filepath,
    phanloai: "Bản vẽ AI",
    active: true,
    create_by: opts.createdBy ?? null,
  })) as Array<{ id: string }>;
  const id = res?.[0]?.id;
  if (!id) throw new Error("Chèn tr_banve thất bại (không trả id).");

  return { id, filepath, url: `/banvesvc/file?id=${id}`, extras };
}
