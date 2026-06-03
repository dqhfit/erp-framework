/* ==========================================================
   MergeFeedbackModal — admin gộp feedback (theo filter đang xem):
   - Tab "Bản gộp": ghép markdown copy được + tổng hợp AI + "Lưu đợt gộp".
   - Tab "Đổi trạng thái": tích chọn mục trong tập đang gộp → đổi hàng loạt.
   - Tab "Đợt đã lưu": các đợt đã đánh dấu; mở 1 đợt → đổi trạng thái cả đợt.
   Tab gộp/đổi-trạng-thái dùng CHUNG tập item (mergeExport) → luôn khớp.
   ========================================================== */
import {
  createFeedbackClient,
  type FeedbackArea,
  type FeedbackStatus,
} from "@erp-framework/client";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, Input, Modal, Select, Tabs, Textarea } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { toast } from "@/lib/toast";

const client = createFeedbackClient("");

interface Filters {
  status?: FeedbackStatus;
  area?: FeedbackArea;
  mine?: boolean;
}
interface MergeItem {
  id: string;
  title: string;
  status: FeedbackStatus | string;
}
interface BatchRow {
  id: string;
  label: string;
  note: string | null;
  itemCount: number;
  createdAt: string;
}
interface Props {
  open: boolean;
  onClose: () => void;
  filters: Filters;
}

type Tab = "doc" | "status" | "saved";
type StatusOpt = { value: FeedbackStatus; label: string };

/** Danh sách item có checkbox + chọn tất cả. */
function ItemChecklist({
  items,
  selected,
  onToggle,
  onToggleAll,
  selectAllLabel,
}: {
  items: MergeItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  selectAllLabel: string;
}) {
  const allSelected = items.length > 0 && selected.size === items.length;
  return (
    <div className="max-h-56 overflow-y-auto border border-border rounded-md divide-y divide-border">
      <label className="flex items-center gap-2 px-3 py-2 bg-bg-soft/40 cursor-pointer text-sm font-medium">
        <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
        {selectAllLabel}
      </label>
      {items.map((it) => (
        <label
          key={it.id}
          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-hover/40 text-sm"
        >
          <input type="checkbox" checked={selected.has(it.id)} onChange={() => onToggle(it.id)} />
          <span className="flex-1 min-w-0 truncate">{it.title}</span>
          <Chip className="text-[10px]! shrink-0">{it.status}</Chip>
        </label>
      ))}
    </div>
  );
}

/** Thanh chọn trạng thái + ghi chú + nút áp dụng. */
function BulkStatusBar({
  opts,
  status,
  setStatus,
  resolution,
  setResolution,
  selectedCount,
  busy,
  onApply,
  applyLabel,
  resolutionPlaceholder,
}: {
  opts: StatusOpt[];
  status: FeedbackStatus;
  setStatus: (s: FeedbackStatus) => void;
  resolution: string;
  setResolution: (s: string) => void;
  selectedCount: number;
  busy: boolean;
  onApply: () => void;
  applyLabel: string;
  resolutionPlaceholder: string;
}) {
  return (
    <>
      <div className="grid grid-cols-3 gap-2 items-start">
        <Select value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Input
          className="col-span-2"
          placeholder={resolutionPlaceholder}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={onApply}
          disabled={busy || selectedCount === 0}
          icon={<I.Check size={14} />}
        >
          {applyLabel.replace("{n}", String(selectedCount))}
        </Button>
      </div>
    </>
  );
}

export function MergeFeedbackModal({ open, onClose, filters }: Props) {
  const t = useT();
  const STATUS_OPTS: StatusOpt[] = [
    { value: "new", label: t("feedback.status_new") },
    { value: "in_progress", label: t("feedback.status_in_progress") },
    { value: "done", label: t("feedback.status_done") },
    { value: "wontfix", label: t("feedback.status_wontfix") },
  ];
  const [tab, setTab] = useState<Tab>("doc");
  const [markdown, setMarkdown] = useState("");
  const [items, setItems] = useState<MergeItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<FeedbackStatus>("in_progress");
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Đợt đã lưu.
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [activeBatch, setActiveBatch] = useState<{
    id: string;
    label: string;
    items: MergeItem[];
  } | null>(null);
  const [batchSel, setBatchSel] = useState<Set<string>>(new Set());

  const run = async (ai: boolean) => {
    setBusy(true);
    setErr("");
    try {
      const r = await client.mergeExport({ ...filters, ai });
      setMarkdown(r.markdown);
      setItems(r.items);
      if (ai && r.aiFailed) toast.warning(t("feedback.merge_ai_failed"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadBatches = async () => {
    setBusy(true);
    try {
      setBatches(await client.listMergeBatches());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Mở modal → ghép thẳng + nạp danh sách item. Reset state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy khi open đổi
  useEffect(() => {
    if (!open) return;
    setTab("doc");
    setMarkdown("");
    setItems([]);
    setSelected(new Set());
    setActiveBatch(null);
    setBatchSel(new Set());
    setErr("");
    void run(false);
  }, [open]);

  // Vào tab "Đợt đã lưu" → nạp danh sách (lần đầu).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ phụ thuộc tab
  useEffect(() => {
    if (open && tab === "saved" && !activeBatch) void loadBatches();
  }, [tab, open]);

  const count = items.length;

  const copy = () => {
    void navigator.clipboard
      .writeText(markdown)
      .then(() => toast.success(t("feedback.merge_copied")))
      .catch(() => toast.error(t("feedback.merge_copy_failed")));
  };

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  /** Áp dụng đổi trạng thái cho 1 danh sách id, rồi gọi onDone làm mới. */
  const applyStatus = async (ids: string[], onDone: () => Promise<void> | void) => {
    if (ids.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const r = await client.bulkSetStatus({
        ids,
        status: bulkStatus,
        resolutionNote: resolution.trim() || undefined,
      });
      toast.success(t("feedback.bulk_status_ok").replace("{n}", String(r.updated)));
      setResolution("");
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveBatch = async () => {
    const label = await dialog.prompt(t("feedback.save_batch_prompt"), "");
    if (label === null) return; // huỷ
    setBusy(true);
    setErr("");
    try {
      const r = await client.saveMergeBatch({ ...filters, label: label.trim() || undefined });
      toast.success(t("feedback.save_batch_ok").replace("{n}", String(r.itemCount)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openBatch = async (id: string) => {
    setBusy(true);
    setErr("");
    try {
      const b = await client.getMergeBatch(id);
      setActiveBatch({ id: b.id, label: b.label, items: b.items });
      setBatchSel(new Set(b.items.map((i) => i.id)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteBatch = async (id: string) => {
    if (!(await dialog.confirm(t("feedback.batch_delete_confirm"), { danger: true }))) return;
    setBusy(true);
    try {
      await client.deleteMergeBatch(id);
      toast.success(t("feedback.batch_deleted"));
      setActiveBatch(null);
      await loadBatches();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={760}
      title={t("feedback.merge_modal_title")}
      footer={
        <Button variant="default" onClick={onClose} disabled={busy}>
          {t("feedback.cancel_btn")}
        </Button>
      }
    >
      <div className="space-y-3">
        {err && <Chip variant="danger">{err}</Chip>}

        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "doc", label: t("feedback.merge_tab_doc") },
            { value: "status", label: t("feedback.merge_tab_status") },
            { value: "saved", label: t("feedback.merge_tab_saved") },
          ]}
        />

        {/* ── Tab Bản gộp ── */}
        {tab === "doc" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted">
                {busy
                  ? t("feedback.merge_loading")
                  : t("feedback.merge_count").replace("{n}", String(count))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void saveBatch()}
                  disabled={busy || count === 0}
                  icon={<I.Check size={14} />}
                >
                  {t("feedback.save_batch_btn")}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void run(true)}
                  disabled={busy || count === 0}
                  icon={<I.Sparkles size={14} />}
                >
                  {t("feedback.merge_ai_btn")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={copy}
                  disabled={busy || !markdown}
                  icon={<I.Copy size={14} />}
                >
                  {t("feedback.merge_copy_btn")}
                </Button>
              </div>
            </div>
            {count === 0 && !busy && !err ? (
              <div className="text-sm text-muted py-6 text-center">{t("feedback.merge_empty")}</div>
            ) : (
              <Textarea
                readOnly
                rows={15}
                value={markdown}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
          </div>
        )}

        {/* ── Tab Đổi trạng thái (tập đang gộp) ── */}
        {tab === "status" &&
          (count === 0 ? (
            <div className="text-sm text-muted py-6 text-center">{t("feedback.merge_empty")}</div>
          ) : (
            <div className="space-y-2">
              <ItemChecklist
                items={items}
                selected={selected}
                onToggle={(id) => toggleIn(selected, setSelected, id)}
                onToggleAll={() =>
                  setSelected(selected.size === count ? new Set() : new Set(items.map((i) => i.id)))
                }
                selectAllLabel={t("feedback.bulk_select_all")}
              />
              <BulkStatusBar
                opts={STATUS_OPTS}
                status={bulkStatus}
                setStatus={setBulkStatus}
                resolution={resolution}
                setResolution={setResolution}
                selectedCount={selected.size}
                busy={busy}
                onApply={() =>
                  void applyStatus([...selected], async () => {
                    setSelected(new Set());
                    await run(false);
                  })
                }
                applyLabel={t("feedback.bulk_apply_btn")}
                resolutionPlaceholder={t("feedback.resolution_placeholder")}
              />
            </div>
          ))}

        {/* ── Tab Đợt đã lưu ── */}
        {tab === "saved" &&
          (activeBatch ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-sm text-accent hover:underline"
                  onClick={() => setActiveBatch(null)}
                >
                  {t("feedback.batch_back")}
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<I.X size={14} />}
                  onClick={() => void deleteBatch(activeBatch.id)}
                  disabled={busy}
                >
                  {t("feedback.batch_delete")}
                </Button>
              </div>
              <div className="font-medium text-sm">{activeBatch.label}</div>
              {activeBatch.items.length === 0 ? (
                <div className="text-sm text-muted py-6 text-center">
                  {t("feedback.merge_empty")}
                </div>
              ) : (
                <>
                  <ItemChecklist
                    items={activeBatch.items}
                    selected={batchSel}
                    onToggle={(id) => toggleIn(batchSel, setBatchSel, id)}
                    onToggleAll={() =>
                      setBatchSel(
                        batchSel.size === activeBatch.items.length
                          ? new Set()
                          : new Set(activeBatch.items.map((i) => i.id)),
                      )
                    }
                    selectAllLabel={t("feedback.bulk_select_all")}
                  />
                  <BulkStatusBar
                    opts={STATUS_OPTS}
                    status={bulkStatus}
                    setStatus={setBulkStatus}
                    resolution={resolution}
                    setResolution={setResolution}
                    selectedCount={batchSel.size}
                    busy={busy}
                    onApply={() =>
                      void applyStatus([...batchSel], async () => {
                        await openBatch(activeBatch.id);
                      })
                    }
                    applyLabel={t("feedback.bulk_apply_btn")}
                    resolutionPlaceholder={t("feedback.resolution_placeholder")}
                  />
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {busy && <div className="text-sm text-muted">{t("feedback.merge_loading")}</div>}
              {!busy && batches.length === 0 ? (
                <div className="text-sm text-muted py-6 text-center">
                  {t("feedback.batches_empty")}
                </div>
              ) : (
                batches.map((b) => (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => void openBatch(b.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:bg-hover/40 text-left text-sm"
                  >
                    <span className="flex-1 min-w-0 truncate font-medium">{b.label}</span>
                    <Chip className="text-[10px]! shrink-0">
                      {t("feedback.batch_items_count").replace("{n}", String(b.itemCount))}
                    </Chip>
                    <span className="text-[11px] text-muted shrink-0">
                      {b.createdAt.slice(0, 16).replace("T", " ")}
                    </span>
                  </button>
                ))
              )}
            </div>
          ))}
      </div>
    </Modal>
  );
}
