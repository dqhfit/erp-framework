/* ==========================================================
   documents-router.ts — tRPC router cho tích hợp OnlyOffice.
   Cấp session config (JWT-signed) để browser khởi tạo editor.
   File serve + callback xử lý ở REST endpoint trong index.ts.
   ========================================================== */
import { createHmac, timingSafeEqual } from "node:crypto";
import { roleCan } from "@erp-framework/core";
import { knowledgeSources } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { rbacProcedure, router } from "./trpc";

const INTERNAL_URL = process.env.ERP_INTERNAL_URL ?? "http://server:8910";
const OO_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET ?? "";

/** Ký JWT HS256 với ONLYOFFICE_JWT_SECRET (không cần thêm dep jsonwebtoken). */
export function signOoJwt(payload: unknown): string {
  if (!OO_JWT_SECRET) throw new Error("ONLYOFFICE_JWT_SECRET not set");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", OO_JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

/** Verify + decode JWT. Ném lỗi nếu sai chữ ký hoặc hết hạn. */
export function verifyOoJwt(token: string): unknown {
  if (!OO_JWT_SECRET) throw new Error("ONLYOFFICE_JWT_SECRET not set — không thể xác thực token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT format invalid");
  const [header, body, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", OO_JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  // So sánh constant-time tránh timing attack.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("JWT signature invalid");
  }
  const decoded = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
  if (typeof decoded.exp === "number" && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("JWT expired");
  }
  return decoded;
}

/** Map MIME type → OnlyOffice documentType + fileType. */
function mimeToDocConfig(mime: string): { documentType: string; fileType: string } {
  if (mime.includes("wordprocessingml") || mime === "application/msword")
    return { documentType: "word", fileType: mime.includes("wordprocessingml") ? "docx" : "doc" };
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel")
    return { documentType: "cell", fileType: mime.includes("spreadsheetml") ? "xlsx" : "xls" };
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint")
    return { documentType: "slide", fileType: mime.includes("presentationml") ? "pptx" : "ppt" };
  if (mime === "application/pdf") return { documentType: "word", fileType: "pdf" };
  if (mime.includes("opendocument.text")) return { documentType: "word", fileType: "odt" };
  if (mime.includes("opendocument.spreadsheet")) return { documentType: "cell", fileType: "ods" };
  if (mime.includes("opendocument.presentation")) return { documentType: "slide", fileType: "odp" };
  // Mặc định: coi là word docx
  return { documentType: "word", fileType: "docx" };
}

export const documentsRouter = router({
  /** Lấy config khởi tạo OnlyOffice editor cho 1 knowledge_source (kind=file).
   *  Trả về object gồm document + editorConfig + token (JWT-signed toàn bộ config).
   *  Browser truyền trực tiếp vào `new DocsAPI.DocEditor(id, config)`. */
  getSession: rbacProcedure("view", "knowledge")
    .input(
      z.object({
        sourceId: z.string().uuid(),
        mode: z.enum(["view", "edit"]).default("view"),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!OO_JWT_SECRET) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ONLYOFFICE_JWT_SECRET chưa cấu hình — vui lòng thêm vào file .env rồi khởi động lại server.",
        });
      }
      const [source] = await ctx.db
        .select()
        .from(knowledgeSources)
        .where(
          and(
            eq(knowledgeSources.id, input.sourceId),
            eq(knowledgeSources.companyId, ctx.user.companyId),
            eq(knowledgeSources.kind, "file"),
          ),
        );
      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy file." });
      }
      const meta = (source.meta ?? {}) as Record<string, unknown>;
      if (!meta.path) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "File chưa được lưu vào ổ đĩa — vui lòng tải lên lại.",
        });
      }

      // mode="edit" yêu cầu quyền edit — không để client tự leo thang từ view.
      if (input.mode === "edit" && !roleCan(ctx.user.role, "edit", "knowledge")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Bạn không có quyền chỉnh sửa tài liệu.",
        });
      }

      const mime = (meta.mime as string | undefined) ?? "application/octet-stream";
      const { documentType, fileType } = mimeToDocConfig(mime);
      const title = (meta.originalName as string | undefined) ?? source.title;

      // editKey: thay đổi mỗi khi save để OnlyOffice làm mới cache.
      const ooMeta = (meta.onlyoffice ?? {}) as Record<string, unknown>;
      const editKey =
        (ooMeta.editKey as string | undefined) ??
        `${input.sourceId.replace(/-/g, "").slice(0, 20)}`;

      // JWT ngắn hạn cho URL file — OnlyOffice dùng để kéo file server→server.
      const fileToken = signOoJwt({
        sourceId: input.sourceId,
        companyId: ctx.user.companyId,
        exp: Math.floor(Date.now() / 1000) + 7200,
      });

      const config = {
        document: {
          fileType,
          key: editKey,
          title,
          url: `${INTERNAL_URL}/doc/file/${input.sourceId}?token=${fileToken}`,
          permissions: {
            edit: input.mode === "edit",
            download: true,
            print: true,
            comment: input.mode === "edit",
          },
        },
        documentType,
        editorConfig: {
          callbackUrl: `${INTERNAL_URL}/doc/callback/${input.sourceId}`,
          user: { id: ctx.user.id, name: (ctx.user as unknown as { name?: string }).name ?? "" },
          lang: "vi",
          mode: input.mode,
        },
      };

      // Token bao toàn bộ config (OnlyOffice yêu cầu payload = { payload: config }).
      const token = signOoJwt({ payload: config });

      return { ...config, token, sourceId: input.sourceId };
    }),
});
