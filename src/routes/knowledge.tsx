/* ==========================================================
   knowledge — Trang Knowledge Base (RAG). Quản lý nguồn tri thức
   (văn bản dán tay / dữ liệu entity / file tải lên) và ô tìm kiếm
   ngữ nghĩa. Nguồn được nạp nền (chunk + embedding); agent cũng tra
   cứu được qua tool "knowledge_search".
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent,
} from "react";
import { Button, Card, Chip, Input, Select, Textarea, FormField, Drawer } from "@/components/ui";
import { I } from "@/components/Icons";
import {
  createKnowledgeClient,
  type KnowledgeSource, type KnowledgeHit,
} from "@erp-framework/client";
import { useUserObjects } from "@/stores/userObjects";
import { dialog } from "@/lib/dialog";

const kb = createKnowledgeClient("");

const KIND_LABEL: Record<string, string> = {
  file: "Tệp", entity: "Dữ liệu ERP", text: "Văn bản",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xử lý", processing: "Đang xử lý",
  ready: "Sẵn sàng", error: "Lỗi",
};

/* Cron preset cho "tự động nạp lại" nguồn entity. */
const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: "Mỗi 15 phút", expr: "*/15 * * * *" },
  { label: "Mỗi giờ", expr: "0 * * * *" },
  { label: "8h sáng hằng ngày", expr: "0 8 * * *" },
];

function StatusChip({ s }: { s: KnowledgeSource }) {
  if (s.status === "ready") return <Chip variant="success">✓ {STATUS_LABEL.ready}</Chip>;
  if (s.status === "error") return <Chip variant="danger">✗ {STATUS_LABEL.error}</Chip>;
  return <Chip>{STATUS_LABEL[s.status] ?? s.status}</Chip>;
}

function KnowledgePage() {
  const entities = useUserObjects((s) => s.entities);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Tìm kiếm
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Thêm nguồn
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");
  const [entityId, setEntityId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Sửa nguồn
  const [editing, setEditing] = useState<KnowledgeSource | null>(null);
  const [edTitle, setEdTitle] = useState("");
  const [edText, setEdText] = useState("");
  const [edCron, setEdCron] = useState("");

  const load = useCallback(() => {
    kb.list()
      .then((rows) => setSources(rows as KnowledgeSource[]))
      .catch(() => { /* chưa đăng nhập */ });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Tự làm mới khi còn nguồn đang xử lý.
  const hasPending = useMemo(
    () => sources.some((s) => s.status === "pending" || s.status === "processing"),
    [sources],
  );
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [hasPending, load]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setErr(""); setMsg("");
    try { await fn(); if (ok) setMsg(ok); load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true); setErr(""); setHits(null);
    try {
      setHits(await kb.search(q, 8) as KnowledgeHit[]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const addText = () => void run(async () => {
    if (!textTitle.trim() || !textBody.trim()) {
      throw new Error("Cần nhập cả tiêu đề lẫn nội dung.");
    }
    await kb.addText(textTitle.trim(), textBody.trim());
    setTextTitle(""); setTextBody("");
  }, "Đã thêm nguồn văn bản — đang nạp nền.");

  const addEntity = () => void run(async () => {
    if (!entityId) throw new Error("Hãy chọn một entity.");
    await kb.addEntity(entityId);
    setEntityId("");
  }, "Đã thêm nguồn entity — đang nạp nền.");

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void run(() => kb.upload(file).then(() => undefined),
        `Đã tải lên "${file.name}" — đang nạp nền.`);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const doReindex = (s: KnowledgeSource) =>
    void run(() => kb.reindex(s.id).then(() => undefined), "Đã yêu cầu nạp lại.");

  const doDelete = async (s: KnowledgeSource) => {
    const ok = await dialog.confirm(`Xoá nguồn "${s.title}"? Không thể hoàn tác.`, {
      title: "Xoá nguồn tri thức", confirmText: "Xoá", danger: true,
    });
    if (ok) void run(() => kb.remove(s.id).then(() => undefined), "Đã xoá nguồn.");
  };

  const textOf = (s: KnowledgeSource) =>
    String((s.meta as { text?: string } | undefined)?.text ?? "");

  const openEdit = (s: KnowledgeSource) => {
    setEditing(s);
    setEdTitle(s.title);
    setEdText(s.kind === "text" ? textOf(s) : "");
    setEdCron(s.reindexCron ?? "");
  };

  const saveEdit = () => {
    const s = editing;
    if (!s) return;
    void run(async () => {
      const patch: { title?: string; text?: string; reindexCron?: string | null } = {};
      if (edTitle.trim() && edTitle.trim() !== s.title) patch.title = edTitle.trim();
      if (s.kind === "text" && edText !== textOf(s)) patch.text = edText;
      if (s.kind === "entity") patch.reindexCron = edCron.trim() || null;
      await kb.update(s.id, patch);
      setEditing(null);
    }, "Đã lưu thay đổi nguồn.");
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Knowledge Base</h1>
        <div className="text-sm text-muted mb-6">
          Nạp tài liệu, dữ liệu ERP và ghi chú thành tri thức có thể tra cứu —
          cho cả người dùng lẫn AI agent. Cần cấu hình{" "}
          <a href="/settings/embedding" className="text-accent hover:underline">
            profile embedding
          </a>{" "}trước.
        </div>

        {/* === Tìm kiếm === */}
        <Card className="mb-4 space-y-3">
          <div className="font-semibold">Tìm trong Knowledge Base</div>
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              placeholder="Nhập câu hỏi hoặc từ khoá…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
            <Button variant="primary" icon={<I.Search size={14} />}
              disabled={searching || !query.trim()} onClick={doSearch}>
              Tìm
            </Button>
          </div>
          {searching && <div className="text-sm text-muted">Đang tìm…</div>}
          {hits && hits.length === 0 && (
            <div className="text-sm text-muted">Không tìm thấy kết quả phù hợp.</div>
          )}
          {hits && hits.length > 0 && (
            <div className="space-y-2">
              {hits.map((h) => (
                <div key={h.chunkId} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <I.File size={12} className="text-muted shrink-0" />
                    <span className="text-xs font-medium truncate">{h.sourceTitle}</span>
                    <Chip className="!text-[10px]">{(h.score * 100).toFixed(0)}%</Chip>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{h.content}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* === Thêm nguồn === */}
        <Card className="mb-4 space-y-4">
          <div className="font-semibold">Thêm nguồn tri thức</div>

          {/* Văn bản dán tay */}
          <div className="space-y-2">
            <FormField label="Văn bản dán tay">
              <Input placeholder="Tiêu đề" value={textTitle} disabled={busy}
                onChange={(e) => setTextTitle(e.target.value)} />
            </FormField>
            <Textarea rows={4} placeholder="Dán nội dung văn bản vào đây…"
              value={textBody} disabled={busy}
              onChange={(e) => setTextBody(e.target.value)} />
            <Button variant="primary" icon={<I.Plus size={14} />}
              disabled={busy} onClick={addText}>
              Thêm văn bản
            </Button>
          </div>

          <div className="border-t border-border" />

          {/* Dữ liệu entity */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <FormField label="Dữ liệu một entity">
                <Select value={entityId} disabled={busy}
                  onChange={(e) => setEntityId(e.target.value)}>
                  <option value="">— Chọn entity —</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </Select>
              </FormField>
            </div>
            <Button variant="primary" icon={<I.Database size={14} />}
              disabled={busy || !entityId} onClick={addEntity}>
              Thêm entity
            </Button>
          </div>

          <div className="border-t border-border" />

          {/* Tải file */}
          <div>
            <div className="text-sm font-medium mb-1">Tải file lên</div>
            <div className="text-xs text-muted mb-2">
              PDF, DOCX, XLSX, PPTX, TXT, MD… (tối đa 25MB) — trích văn bản qua
              Apache Tika.
            </div>
            <input ref={fileRef} type="file" disabled={busy} onChange={onPickFile}
              className="text-sm" />
          </div>
        </Card>

        {/* === Danh sách nguồn === */}
        <Card className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="font-semibold">Nguồn tri thức ({sources.length})</div>
            <div className="flex-1" />
            <Button size="sm" variant="default" icon={<I.Undo size={12} />}
              onClick={load}>Làm mới</Button>
          </div>
          {sources.length === 0 && (
            <div className="text-sm text-muted py-4 text-center">
              Chưa có nguồn nào. Thêm văn bản, entity hoặc tải file lên.
            </div>
          )}
          {sources.map((s) => (
            <div key={s.id} className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Chip className="!text-[10px]">{KIND_LABEL[s.kind] ?? s.kind}</Chip>
                <span className="font-medium truncate flex-1">{s.title}</span>
                {s.reindexCron && (
                  <Chip variant="accent" className="!text-[10px]">
                    <I.Clock size={9} /> {s.reindexCron}
                  </Chip>
                )}
                <StatusChip s={s} />
                {s.status === "ready" && (
                  <span className="text-xs text-muted">{s.chunkCount} đoạn</span>
                )}
                <Button size="sm" variant="default" icon={<I.Edit size={12} />}
                  disabled={busy} onClick={() => openEdit(s)}>Sửa</Button>
                <Button size="sm" variant="default" icon={<I.Redo size={12} />}
                  disabled={busy} onClick={() => doReindex(s)}>Nạp lại</Button>
                <Button size="sm" variant="danger" icon={<I.Trash size={12} />}
                  disabled={busy} onClick={() => void doDelete(s)} />
              </div>
              {s.status === "error" && s.error && (
                <div className="text-xs text-danger mt-1.5">{s.error}</div>
              )}
            </div>
          ))}
        </Card>

        {msg && <div className="mt-4"><Chip variant="success">{msg}</Chip></div>}
        {err && <div className="mt-4"><Chip variant="danger">{err}</Chip></div>}

        {/* === Drawer sửa nguồn === */}
        <Drawer open={!!editing} onClose={() => setEditing(null)}
          title="Sửa nguồn tri thức">
          {editing && (
            <div className="p-4 space-y-3">
              <FormField label="Tiêu đề">
                <Input value={edTitle} disabled={busy}
                  onChange={(e) => setEdTitle(e.target.value)} />
              </FormField>

              {editing.kind === "text" && (
                <FormField label="Nội dung">
                  <Textarea rows={10} value={edText} disabled={busy}
                    onChange={(e) => setEdText(e.target.value)} />
                </FormField>
              )}

              {editing.kind === "entity" && (
                <FormField label="Tự động nạp lại theo lịch">
                  <div className="space-y-2">
                    <div className="text-xs text-muted">
                      Server tự nạp lại dữ liệu entity vào tri thức theo lịch cron.
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CRON_PRESETS.map((p) => (
                        <button
                          key={p.expr} type="button"
                          onClick={() => setEdCron(p.expr)}
                          className={"chip cursor-pointer " + (edCron === p.expr ? "chip-accent" : "")}
                        >
                          {p.label}
                        </button>
                      ))}
                      <button
                        type="button" onClick={() => setEdCron("")}
                        className={"chip cursor-pointer " + (!edCron ? "chip-accent" : "")}
                      >
                        Tắt
                      </button>
                    </div>
                    <Input
                      className="font-mono text-xs"
                      placeholder="Biểu thức cron (để trống = tắt)"
                      value={edCron} disabled={busy}
                      onChange={(e) => setEdCron(e.target.value)}
                    />
                  </div>
                </FormField>
              )}

              {editing.kind === "file" && (
                <div className="text-xs text-muted">
                  Nguồn tệp chỉ sửa được tiêu đề. Muốn đổi nội dung, hãy xoá rồi
                  tải tệp mới.
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button variant="ghost" onClick={() => setEditing(null)}>Hủy</Button>
                <Button variant="primary" icon={<I.Save size={13} />}
                  disabled={busy} onClick={saveEdit}>
                  Lưu
                </Button>
              </div>
            </div>
          )}
        </Drawer>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/knowledge")({ component: KnowledgePage });
