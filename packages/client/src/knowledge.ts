/* ==========================================================
   knowledge.ts — Client Knowledge Base: bọc router knowledge.* của
   server (nguồn tri thức, tra cứu RAG, profile embedding). Tải file
   đi qua route /upload (multipart) — ngoài tRPC.
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export interface KnowledgeSource {
  id: string;
  kind: "file" | "entity" | "text";
  title: string;
  status: "pending" | "processing" | "ready" | "error";
  chunkCount: number;
  error: string | null;
  /** Biểu thức cron tự nạp lại (chỉ nguồn entity); null = tắt. */
  reindexCron: string | null;
  /** Phân quyền: "private" = chỉ người tạo; "restricted" = user/nhóm được cấp;
   *  "company" = mọi user trong công ty (mặc định); "public" = ai có link. */
  visibility?: "private" | "company" | "restricted" | "public";
  /** UUID cho link chia sẻ công khai (chỉ khi visibility="public"). */
  shareToken?: string | null;
  /** Dữ liệu phụ: nguồn text chứa { text } — dùng cho form sửa. ingest =
   *  thống kê tiến độ/tốc độ embedding lần nạp gần nhất (worker ghi). */
  meta?: Record<string, unknown> & {
    /** "live" = nguồn entity on-demand (không embed, truy vấn trực tiếp). */
    mode?: "embed" | "live";
    ingest?: {
      total?: number;
      embedded?: number;
      ms?: number;
      perSec?: number;
      startedAt?: string;
      finishedAt?: string;
      /** Cảnh báo khi nguồn bị giới hạn (entity/đoạn quá lớn) — null nếu không. */
      warn?: string | null;
    };
  };
  createdAt: string;
}

export interface KnowledgeHit {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceKind: string;
  seq: number;
  content: string;
  score: number;
}

export interface EmbeddingProfileInput {
  adapter: "ollama" | "openai";
  model: string;
  endpoint?: string;
  apiKeyEnc?: string;
}

/** Tạo client gọi knowledge.* của server. */
export function createKnowledgeClient(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: base + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    /** Tất cả nguồn tri thức của công ty (không lọc scope). */
    list: () => trpc.knowledge.sources.list.query({}),
    /** Lọc theo scope cho trang Documents. */
    listByScope: (scope: "mine" | "shared" | "company") =>
      trpc.knowledge.sources.list.query({ scope }),
    /** Một nguồn theo id (null nếu không có). */
    get: (id: string) => trpc.knowledge.sources.get.query(id),
    /** Xoá nguồn (cascade xoá các đoạn). */
    remove: (id: string) => trpc.knowledge.sources.delete.mutate(id),
    /** Thêm nguồn từ văn bản dán tay. */
    addText: (title: string, text: string) => trpc.knowledge.addText.mutate({ title, text }),
    /** Thêm nguồn từ dữ liệu một entity. */
    addEntity: (entityId: string, title?: string, mode?: "embed" | "live") =>
      trpc.knowledge.addEntity.mutate({ entityId, title, mode }),
    /** Nạp lại một nguồn. */
    reindex: (id: string) => trpc.knowledge.reindex.mutate(id),
    /** Sửa nguồn: tiêu đề / nội dung văn bản / lịch tự nạp lại
       (reindexCron: chuỗi cron, hoặc null để tắt). */
    update: (
      id: string,
      patch: {
        title?: string;
        text?: string;
        reindexCron?: string | null;
      },
    ) => trpc.knowledge.sources.update.mutate({ id, ...patch }),
    /** Tra cứu ANN cosine. */
    search: (query: string, limit?: number) => trpc.knowledge.search.query({ query, limit }),
    /** Phân quyền hiện tại của nguồn (visibility + nhóm + user được cấp). */
    getAcl: (id: string) => trpc.knowledge.sources.acl.query(id),
    /** Đặt phân quyền nguồn: visibility + thay thế danh sách nhóm + user. */
    setAcl: (input: {
      id: string;
      visibility: "private" | "company" | "restricted" | "public";
      groupIds: string[];
      userIds: string[];
    }) => trpc.knowledge.sources.setAcl.mutate(input),
    /** Sinh share link công khai (idempotent). Trả { token }. */
    generateShareLink: (sourceId: string) =>
      trpc.knowledge.sources.generateShareLink.mutate(sourceId),
    /** Thu hồi share link công khai → visibility trở về "company". */
    revokeShareLink: (sourceId: string) => trpc.knowledge.sources.revokeShareLink.mutate(sourceId),
    /** Tải file lên với visibility tùy chọn. */
    uploadWithVisibility: async (
      file: File,
      visibility: "private" | "company" | "restricted" | "public" = "company",
    ): Promise<{ id: string; title: string; status: string }> => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("visibility", visibility);
      const res = await fetch(base + "/upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        let msg = `Tải lên lỗi ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* body không phải JSON */
        }
        throw new Error(msg);
      }
      return res.json() as Promise<{ id: string; title: string; status: string }>;
    },
    /** Cấu hình embedding hiện tại (null nếu chưa có). */
    getEmbeddingProfile: () => trpc.knowledge.embeddingProfile.get.query(),
    /** Lưu cấu hình embedding. */
    saveEmbeddingProfile: (p: EmbeddingProfileInput) =>
      trpc.knowledge.embeddingProfile.save.mutate(p),
    /** Tải file lên — multipart/form-data qua route /upload. */
    upload: async (file: File): Promise<{ id: string; title: string; status: string }> => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(base + "/upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        let msg = `Tải lên lỗi ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* body không phải JSON */
        }
        throw new Error(msg);
      }
      return res.json() as Promise<{ id: string; title: string; status: string }>;
    },
  };
}

export type KnowledgeClient = ReturnType<typeof createKnowledgeClient>;
