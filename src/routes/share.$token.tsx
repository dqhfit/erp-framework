/* ==========================================================
   /share/:token — Trang chia sẻ công khai (không cần đăng nhập).
   Ai có link đều truy cập, xem + tải xuống tài liệu.
   ========================================================== */
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button } from "@/components/ui";

interface ShareMeta {
  id: string;
  title: string;
  kind: string;
  mime: string;
  originalName: string;
  size: number;
  createdAt: string;
}

const OFFICE_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

function humanSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function SharePage() {
  const { token } = useParams({ from: "/share/$token" });
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/doc/share-meta/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Lỗi ${r.status}`);
        }
        return r.json() as Promise<ShareMeta>;
      })
      .then(setMeta)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const fileUrl = `/doc/share-file/${token}`;
  const downloadUrl = `/doc/share-file/${token}?download=1`;

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg text-muted">Đang tải…</div>
    );
  }

  if (error || !meta) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-bg gap-4 p-6 text-center">
        <I.FileX size={48} className="text-muted opacity-40" />
        <h1 className="text-xl font-bold text-text">Link không hợp lệ hoặc đã hết hạn</h1>
        <p className="text-sm text-muted max-w-sm">
          {error ?? "Tài liệu này không còn được chia sẻ công khai."}
        </p>
      </div>
    );
  }

  const isImage = meta.mime.startsWith("image/");
  const isPdf = meta.mime === "application/pdf";
  const isOffice = OFFICE_MIMES.has(meta.mime);

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-4 bg-panel">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-text truncate">{meta.title}</h1>
          <div className="text-xs text-muted mt-0.5">
            {humanSize(meta.size)} · {meta.mime.split("/").pop()?.toUpperCase()} ·{" "}
            {new Date(meta.createdAt).toLocaleDateString("vi-VN")}
          </div>
        </div>
        <a href={downloadUrl} download={meta.originalName}>
          <Button size="sm">
            <I.Download size={14} />
            Tải xuống
          </Button>
        </a>
      </div>

      {/* Preview */}
      <div className="flex-1 overflow-hidden">
        {isImage && (
          <div className="flex items-center justify-center p-8 h-full">
            <img
              src={fileUrl}
              alt={meta.title}
              className="max-w-full max-h-full object-contain rounded-lg shadow"
            />
          </div>
        )}
        {isPdf && (
          <iframe
            src={fileUrl}
            title={meta.title}
            className="w-full h-full border-0"
            style={{ minHeight: "calc(100vh - 80px)" }}
          />
        )}
        {isOffice && (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
            <I.File size={48} className="text-muted opacity-40" />
            <div>
              <p className="text-sm font-medium text-text">{meta.title}</p>
              <p className="text-xs text-muted mt-1">
                File Office — không thể xem trực tiếp trên trình duyệt
              </p>
            </div>
            <a href={downloadUrl} download={meta.originalName}>
              <Button>
                <I.Download size={14} />
                Tải xuống để xem
              </Button>
            </a>
          </div>
        )}
        {!isImage && !isPdf && !isOffice && (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
            <I.File size={48} className="text-muted opacity-40" />
            <div>
              <p className="text-sm font-medium text-text">{meta.title}</p>
              <p className="text-xs text-muted mt-1">
                Không hỗ trợ xem trực tiếp — tải xuống để mở
              </p>
            </div>
            <a href={downloadUrl} download={meta.originalName}>
              <Button>
                <I.Download size={14} />
                Tải xuống
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/share/$token")({ component: SharePage });
