/* ==========================================================
   /documents — Quản lý tài liệu cá nhân.
   3 tab: Của tôi / Được chia sẻ / Toàn công ty.
   Upload, xem (OnlyOffice), tải xuống, chia sẻ, xoá.
   ========================================================== */
import { createKnowledgeClient, type KnowledgeSource } from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ShareModal } from "@/components/documents/ShareModal";
import { I } from "@/components/Icons";
import { Button, Chip } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const kb = createKnowledgeClient("");

type Scope = "mine" | "shared" | "company";
type Visibility = "private" | "restricted" | "company" | "public";

const SCOPE_TABS: { value: Scope; label: string }[] = [
  { value: "mine", label: "Của tôi" },
  { value: "shared", label: "Được chia sẻ" },
  { value: "company", label: "Toàn công ty" },
];

const MIME_ICON: Record<string, string> = {
  "application/pdf": "📄",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "📝",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "📊",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "📊",
  "image/png": "🖼️",
  "image/jpeg": "🖼️",
  "text/plain": "📃",
};

function mimeIcon(mime?: string): string {
  if (!mime) return "📁";
  return MIME_ICON[mime] ?? "📁";
}

const VIS_BADGE: Record<Visibility, { label: string; cls: string }> = {
  private: { label: "Chỉ mình", cls: "chip-neutral" },
  restricted: { label: "Giới hạn", cls: "chip-warning" },
  company: { label: "Công ty", cls: "chip-info" },
  public: { label: "Công khai", cls: "chip-success" },
};

function VisibilityBadge({ v }: { v: string }) {
  const badge = VIS_BADGE[v as Visibility] ?? { label: v, cls: "chip-neutral" };
  return <Chip className={badge.cls}>{badge.label}</Chip>;
}

function FileCard({
  src,
  onShare,
  onDelete,
  onOpen,
}: {
  src: KnowledgeSource;
  onShare: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const meta = (src.meta ?? {}) as Record<string, unknown>;
  const mime = meta.mime as string | undefined;
  const size = meta.size as number | undefined;
  const sizeStr = size
    ? size > 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.round(size / 1024)} KB`
    : "";

  return (
    <div className="card p-4 flex flex-col gap-2 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none flex-shrink-0">{mimeIcon(mime)}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text truncate" title={src.title}>
            {src.title}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {sizeStr}
            {sizeStr && " · "}
            {new Date(src.createdAt).toLocaleDateString("vi-VN")}
          </div>
        </div>
        <VisibilityBadge v={src.visibility ?? "company"} />
      </div>
      <div className="flex gap-1.5 mt-1">
        <Button size="sm" variant="ghost" onClick={onOpen} title="Mở / Xem">
          <I.Eye size={13} />
          Xem
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const meta2 = (src.meta ?? {}) as Record<string, unknown>;
            const path = meta2.path as string | undefined;
            if (!path) return;
            window.open(`/files/${src.id}`, "_blank");
          }}
          title="Tải xuống"
        >
          <I.Download size={13} />
        </Button>
        <Button size="sm" variant="ghost" onClick={onShare} title="Chia sẻ">
          <I.Share size={13} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          title="Xoá"
          className="ml-auto text-danger"
        >
          <I.Trash size={13} />
        </Button>
      </div>
    </div>
  );
}

function DocumentsPage() {
  const [scope, setScope] = useState<Scope>("mine");
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState<KnowledgeSource | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await kb.listByScope(scope);
      setSources(rows.filter((r) => r.kind === "file") as KnowledgeSource[]);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await kb.uploadWithVisibility(file, "company");
      }
      await load();
    } catch (e) {
      void dialog.alert(`Tải lên thất bại: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (src: KnowledgeSource) => {
    const ok = await dialog.confirm(`Xoá tài liệu "${src.title}"? Thao tác không thể hoàn tác.`);
    if (!ok) return;
    await kb.remove(src.id);
    await load();
  };

  const handleOpen = (src: KnowledgeSource) => {
    // Mở trang xem tài liệu với OnlyOffice viewer
    window.open(`/knowledge?view=${src.id}`, "_blank");
  };

  return (
    <div
      className="flex-1 overflow-y-auto p-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleUpload(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="fixed inset-0 bg-accent/10 border-4 border-accent border-dashed z-50 flex items-center justify-center pointer-events-none">
          <div className="text-accent text-2xl font-bold">Thả file để tải lên</div>
        </div>
      )}

      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-text">Tài liệu</h1>
            <p className="text-sm text-muted mt-0.5">Quản lý tài liệu cá nhân và chia sẻ</p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void handleUpload(e.target.files)}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
              <I.Upload size={14} />
              {uploading ? "Đang tải..." : "Tải lên"}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-6">
          {SCOPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setScope(tab.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                scope === tab.value
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-text"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted">Đang tải...</div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted gap-3">
            <I.File size={40} className="opacity-30" />
            <div className="text-sm">
              {scope === "mine"
                ? "Bạn chưa có tài liệu nào. Tải lên file đầu tiên!"
                : scope === "shared"
                  ? "Chưa có tài liệu nào được chia sẻ với bạn."
                  : "Chưa có tài liệu công ty nào."}
            </div>
            {scope === "mine" && (
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <I.Upload size={13} />
                Tải lên
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sources.map((src) => (
              <FileCard
                key={src.id}
                src={src}
                onShare={() => setSharing(src)}
                onDelete={() => void handleDelete(src)}
                onOpen={() => handleOpen(src)}
              />
            ))}
          </div>
        )}
      </div>

      {sharing && (
        <ShareModal
          source={sharing}
          onClose={() => {
            setSharing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute("/documents")({ component: DocumentsPage });
