/* ==========================================================
   knowledge.ts — Client Knowledge Base: bọc router knowledge.* của
   server (nguồn tri thức, tra cứu RAG, profile embedding). Tải file
   đi qua route /upload (multipart) — ngoài tRPC.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface KnowledgeSource {
  id: string;
  kind: "file" | "entity" | "text";
  title: string;
  status: "pending" | "processing" | "ready" | "error";
  chunkCount: number;
  error: string | null;
  /** Biểu thức cron tự nạp lại (chỉ nguồn entity); null = tắt. */
  reindexCron: string | null;
  /** Dữ liệu phụ: nguồn text chứa { text } — dùng cho form sửa. ingest =
   *  thống kê tiến độ/tốc độ embedding lần nạp gần nhất (worker ghi). */
  meta?: Record<string, unknown> & {
    ingest?: {
      total?: number;
      embedded?: number;
      ms?: number;
      perSec?: number;
      startedAt?: string;
      finishedAt?: string;
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
    /** Tất cả nguồn tri thức của công ty. */
    list: () => trpc.knowledge.sources.list.query(),
    /** Một nguồn theo id (null nếu không có). */
    get: (id: string) => trpc.knowledge.sources.get.query(id),
    /** Xoá nguồn (cascade xoá các đoạn). */
    remove: (id: string) => trpc.knowledge.sources.delete.mutate(id),
    /** Thêm nguồn từ văn bản dán tay. */
    addText: (title: string, text: string) => trpc.knowledge.addText.mutate({ title, text }),
    /** Thêm nguồn từ dữ liệu một entity. */
    addEntity: (entityId: string, title?: string) =>
      trpc.knowledge.addEntity.mutate({ entityId, title }),
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
