/* ==========================================================
   settings.viewer-groups.tsx — Quản lý nhóm người xem.
   Layout master-detail: cột trái = danh sách nhóm,
   cột phải = tab (Thành viên | Trang được phép | Cài đặt).
   ========================================================== */

import { createCompaniesClient, createObjectsClient } from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input, SearchableSelect, type SearchableSelectOption } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import type { EntityField } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig } from "@/types/page";

const api = createObjectsClient("");
const companiesApi = createCompaniesClient("");

interface CompanyMember {
  userId: string;
  email: string;
  name: string;
  role: string;
}

const PRESET_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#06b6d4",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ec4899",
  "#f97316",
  "#84cc16",
  "#ef4444",
  "#64748b",
  "#a16207",
];

/* ── Helpers: phân quyền nút hành động theo nhóm ──────────── */

/** Kiểu mô tả 1 nút action trích từ content trang.
 *  (compId, arrayKey, index) là đường dẫn ổn định để ghi lại. */
interface ActionEntry {
  compId: string;
  compKind: string;
  compLabel: string;
  arrayKey: "rowActions" | "embeddedActions" | "items" | "action";
  /** −1 cho widget "action" đơn (cả config là 1 action). */
  index: number;
  label: string;
  icon?: string;
  visibleToGroups?: string[];
  /** Danh sách userId được phép thấy nút (song song visibleToGroups). */
  visibleToUsers?: string[];
}

/** Chuyển raw content (2 format: array cũ / {meta,components}) thành mảng component. */
function parsePageComponents(
  raw: unknown,
): Array<{ id: string; kind: string; config: Record<string, unknown> }> {
  if (!raw) return [];
  if (Array.isArray(raw))
    return raw as Array<{ id: string; kind: string; config: Record<string, unknown> }>;
  const obj = raw as {
    components?: Array<{ id: string; kind: string; config: Record<string, unknown> }>;
  };
  return obj.components ?? [];
}

/** Duyệt mọi component, trả danh sách phẳng tất cả action button. */
function extractPageActions(rawContent: unknown): ActionEntry[] {
  const comps = parsePageComponents(rawContent);
  const result: ActionEntry[] = [];

  for (const comp of comps) {
    const cfg = comp.config ?? {};

    if (comp.kind === "action") {
      /* Widget đơn — toàn bộ config là 1 ActionConfig. */
      result.push({
        compId: comp.id,
        compKind: "action",
        compLabel: "Action",
        arrayKey: "action",
        index: -1,
        label: (cfg.label as string) || "(nút không tên)",
        icon: cfg.icon as string | undefined,
        visibleToGroups: cfg.visibleToGroups as string[] | undefined,
        visibleToUsers: cfg.visibleToUsers as string[] | undefined,
      });
    } else if (comp.kind === "actionbar") {
      /* Thanh hành động — config.items[]. */
      const barTitle = (cfg.title as string) || "Thanh hành động";
      const items = (cfg.items ?? []) as Array<ActionConfig & { id?: string }>;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        result.push({
          compId: comp.id,
          compKind: "actionbar",
          compLabel: barTitle,
          arrayKey: "items",
          index: i,
          label: item.label || "(nút không tên)",
          icon: item.icon,
          visibleToGroups: item.visibleToGroups,
          visibleToUsers: item.visibleToUsers,
        });
      }
    } else if (comp.kind === "list" || comp.kind === "form" || comp.kind === "detail") {
      /* List / Form / Detail — rowActions[] (list-only) + embeddedActions[]. */
      const widgetLabel = (cfg.title as string) || (cfg.entity as string) || comp.kind;

      if (comp.kind === "list") {
        const rowActions = (cfg.rowActions ?? []) as ActionConfig[];
        for (let i = 0; i < rowActions.length; i++) {
          const ra = rowActions[i];
          if (!ra) continue;
          result.push({
            compId: comp.id,
            compKind: "list",
            compLabel: `${widgetLabel} — nút dòng`,
            arrayKey: "rowActions",
            index: i,
            label: ra.label || "(nút không tên)",
            icon: ra.icon,
            visibleToGroups: ra.visibleToGroups,
            visibleToUsers: ra.visibleToUsers,
          });
        }
      }

      const embActs = (cfg.embeddedActions ?? []) as Array<ActionConfig & { id?: string }>;
      for (let i = 0; i < embActs.length; i++) {
        const ea = embActs[i];
        if (!ea) continue;
        result.push({
          compId: comp.id,
          compKind: comp.kind,
          compLabel: `${widgetLabel} — nút nhúng`,
          arrayKey: "embeddedActions",
          index: i,
          label: ea.label || "(nút không tên)",
          icon: ea.icon,
          visibleToGroups: ea.visibleToGroups,
          visibleToUsers: ea.visibleToUsers,
        });
      }
    }
  }

  return result;
}

/** Tính danh sách nhóm mới sau khi thêm/bỏ groupId.
 *  Trả null = xoá field (không còn hạn chế → "Mọi nhóm"). */
function computeNewGroups(
  current: string[] | undefined,
  groupId: string,
  add: boolean,
): string[] | null {
  if (add) {
    const list = [...(current ?? [])];
    if (!list.includes(groupId)) list.push(groupId);
    return list;
  }
  const list = (current ?? []).filter((id) => id !== groupId);
  return list.length > 0 ? list : null;
}

/** Áp dụng thay đổi visibleToGroups vào raw content, giữ nguyên cấu trúc gốc. */
function applyGroupToggle(
  rawContent: unknown,
  entry: ActionEntry,
  groupId: string,
  turnOn: boolean,
): unknown {
  const comps = parsePageComponents(rawContent).map((comp) => {
    if (comp.id !== entry.compId) return comp;
    const cfg = { ...(comp.config ?? {}) };

    if (entry.arrayKey === "action") {
      /* Widget đơn — sửa trực tiếp trên config. */
      const newGroups = computeNewGroups(
        cfg.visibleToGroups as string[] | undefined,
        groupId,
        turnOn,
      );
      const updated = { ...cfg };
      if (newGroups === null) delete updated.visibleToGroups;
      else updated.visibleToGroups = newGroups;
      return { ...comp, config: updated };
    }

    /* Mảng rowActions / embeddedActions / items */
    const arr = [...((cfg[entry.arrayKey] as unknown[]) ?? [])];
    const item = arr[entry.index];
    if (!item) return comp;
    const currGroups = (item as { visibleToGroups?: string[] }).visibleToGroups;
    const newGroups = computeNewGroups(currGroups, groupId, turnOn);
    const updatedItem = { ...(item as object) } as Record<string, unknown>;
    if (newGroups === null) delete updatedItem.visibleToGroups;
    else updatedItem.visibleToGroups = newGroups;
    arr[entry.index] = updatedItem;
    return { ...comp, config: { ...cfg, [entry.arrayKey]: arr } };
  });

  /* Giữ nguyên shape: array → array; {meta, components} → {meta, components}. */
  if (Array.isArray(rawContent)) return comps;
  const obj = rawContent as { meta?: unknown; components?: unknown };
  return { ...obj, components: comps };
}

/** Áp dụng thay đổi visibleToUsers vào raw content, giữ nguyên cấu trúc gốc.
 *  Song song applyGroupToggle nhưng patch visibleToUsers thay vì visibleToGroups. */
function applyUserToggle(
  rawContent: unknown,
  entry: ActionEntry,
  userId: string,
  turnOn: boolean,
): unknown {
  const comps = parsePageComponents(rawContent).map((comp) => {
    if (comp.id !== entry.compId) return comp;
    const cfg = { ...(comp.config ?? {}) };

    if (entry.arrayKey === "action") {
      /* Widget đơn — sửa trực tiếp trên config. */
      const newUsers = computeNewGroups(cfg.visibleToUsers as string[] | undefined, userId, turnOn);
      const updated = { ...cfg };
      if (newUsers === null) delete updated.visibleToUsers;
      else updated.visibleToUsers = newUsers;
      return { ...comp, config: updated };
    }

    /* Mảng rowActions / embeddedActions / items */
    const arr = [...((cfg[entry.arrayKey] as unknown[]) ?? [])];
    const item = arr[entry.index];
    if (!item) return comp;
    const currUsers = (item as { visibleToUsers?: string[] }).visibleToUsers;
    const newUsers = computeNewGroups(currUsers, userId, turnOn);
    const updatedItem = { ...(item as object) } as Record<string, unknown>;
    if (newUsers === null) delete updatedItem.visibleToUsers;
    else updatedItem.visibleToUsers = newUsers;
    arr[entry.index] = updatedItem;
    return { ...comp, config: { ...cfg, [entry.arrayKey]: arr } };
  });

  /* Giữ nguyên shape: array → array; {meta, components} → {meta, components}. */
  if (Array.isArray(rawContent)) return comps;
  const obj = rawContent as { meta?: unknown; components?: unknown };
  return { ...obj, components: comps };
}

/* ── ColorPicker ──────────────────────────────────────────── */
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="w-5 h-5 rounded-full transition-all shrink-0"
          style={{
            backgroundColor: c,
            outline: value === c ? `2px solid ${c}` : "none",
            outlineOffset: "2px",
          }}
          title={c}
        />
      ))}
    </div>
  );
}

/* ── GroupList (cột trái) ─────────────────────────────────── */
function GroupList({
  groups,
  selectedId,
  onSelect,
  onNew,
}: {
  groups: { id: string; name: string; color: string; memberIds: string[]; pageIds: string[] }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-col h-full border-r border-border">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/60">
          Nhóm
        </span>
        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-0.5 text-[11px] text-accent hover:text-accent/80 transition-colors"
        >
          <I.Plus size={11} />
          Tạo nhóm
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {groups.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted/60 text-center">Chưa có nhóm nào.</div>
        ) : (
          groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors",
                selectedId === g.id ? "bg-accent/10 text-text" : "hover:bg-hover text-text",
              )}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: g.color }}
              />
              <span className="flex-1 text-sm font-medium truncate">{g.name}</span>
              <span className="text-[11px] text-muted tabular-nums shrink-0">
                {g.memberIds.length}
                <I.User size={10} className="inline ml-0.5 opacity-60" />
              </span>
              <span className="text-[11px] text-muted tabular-nums shrink-0">
                {g.pageIds.length}
                <I.Layout size={10} className="inline ml-0.5 opacity-60" />
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ── NewGroupPanel ────────────────────────────────────────── */
function NewGroupPanel({ onDone }: { onDone: () => void }) {
  const hydrate = useUserObjects((s) => s.hydrate);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0] ?? "#6366f1");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.viewerGroups.create(name.trim(), color);
      await hydrate();
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-2 border-b border-border shrink-0">
        <h2 className="text-xs font-semibold text-muted/80">Tạo nhóm mới</h2>
      </div>
      <div className="px-6 py-5 flex flex-col gap-4 max-w-sm">
        <div>
          <label className="block text-xs text-muted mb-1.5">Tên nhóm</label>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Kinh doanh, Kỹ thuật…"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
            }}
            className="input w-full"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1.5">Màu nhận diện</label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim()}
          >
            {saving ? "Đang tạo…" : "Tạo nhóm"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDone}>
            Hủy
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── FieldPermissionsTab ─────────────────────────────────── */
function FieldPermissionsTab({ groupId }: { groupId: string }) {
  const entities = useUserObjects((s) => s.entities);
  const hydrate = useUserObjects((s) => s.hydrate);

  const entityList = useMemo(
    () =>
      entities
        .filter((e) => e.fields.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    [entities],
  );

  const [selId, setSelId] = useState<string>(() => entityList[0]?.id ?? "");
  const [search, setSearch] = useState("");
  // pending: fieldName → { read, write }
  const [pending, setPending] = useState<Record<string, { read: boolean; write: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const selEntity = entityList.find((e) => e.id === selId) ?? entityList[0] ?? null;

  // Reset pending khi đổi entity
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on entity switch
  useEffect(() => {
    setPending({});
    setSavedMsg("");
  }, [selId]);

  // Đồng bộ selId khi entityList load lần đầu
  useEffect(() => {
    if (!selId && entityList.length > 0) setSelId(entityList[0]?.id ?? "");
  }, [entityList, selId]);

  const getRead = (f: EntityField) =>
    f.name in pending
      ? (pending[f.name]?.read ?? false)
      : (f.readableByGroups?.includes(groupId) ?? false);

  const getWrite = (f: EntityField) =>
    f.name in pending
      ? (pending[f.name]?.write ?? false)
      : (f.writableByGroups?.includes(groupId) ?? false);

  const toggle = (f: EntityField, key: "read" | "write", val: boolean) => {
    setPending((p) => ({
      ...p,
      [f.name]: { read: getRead(f), write: getWrite(f), [key]: val },
    }));
  };

  const hasPending = Object.keys(pending).length > 0;

  const handleSave = async () => {
    if (!selEntity || !hasPending) return;
    setSaving(true);
    try {
      const updatedFields = selEntity.fields.map((f) => {
        if (!(f.name in pending)) return f;
        const { read, write } = pending[f.name] ?? { read: false, write: false };
        const rg = read
          ? [...new Set([...(f.readableByGroups ?? []), groupId])]
          : (f.readableByGroups ?? []).filter((id) => id !== groupId);
        const wg = write
          ? [...new Set([...(f.writableByGroups ?? []), groupId])]
          : (f.writableByGroups ?? []).filter((id) => id !== groupId);
        return {
          ...f,
          readableByGroups: rg.length > 0 ? rg : undefined,
          writableByGroups: wg.length > 0 ? wg : undefined,
        };
      });
      await api.entities.save({
        id: selEntity.id,
        name: selEntity.techName?.trim() || selEntity.name,
        label: selEntity.name,
        icon: selEntity.icon,
        fields: updatedFields,
        meta: {},
      });
      await hydrate();
      setPending({});
      setSavedMsg("Đã lưu");
      setTimeout(() => setSavedMsg(""), 2500);
    } finally {
      setSaving(false);
    }
  };

  const filteredFields = useMemo(() => {
    if (!selEntity) return [];
    const q = search.toLowerCase();
    return selEntity.fields.filter(
      (f) => !q || f.name.toLowerCase().includes(q) || f.label?.toLowerCase().includes(q),
    );
  }, [selEntity, search]);

  if (entityList.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted/60">
        Chưa có thực thể nào.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="px-3 pt-3 pb-2 border-b border-border shrink-0 space-y-2">
        {/* Entity picker */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted shrink-0">Thực thể:</span>
          <select
            value={selId}
            onChange={(e) => setSelId(e.target.value)}
            className="flex-1 text-xs border border-border rounded px-2 py-1 bg-bg text-text focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {entityList.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          {savedMsg && <span className="text-[11px] text-success shrink-0">{savedMsg}</span>}
          <Button
            variant="primary"
            size="sm"
            disabled={!hasPending || saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </div>
        {/* Field search */}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm trường…"
          className="text-xs"
        />
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 border-b border-border sticky top-0 bg-bg-soft/80 backdrop-blur-sm">
          <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide">
            Trường
          </span>
          <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-16 text-center">
            Kiểu
          </span>
          <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-10 text-center">
            Đọc
          </span>
          <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-10 text-center">
            Ghi
          </span>
        </div>

        {filteredFields.length === 0 && (
          <div className="text-xs text-muted/60 text-center py-6">Không tìm thấy trường nào.</div>
        )}
        {filteredFields.map((f) => {
          const r = getRead(f);
          const w = getWrite(f);
          const dirty = f.name in pending;
          // Đếm nhóm khác đang có quyền đọc/ghi (không tính nhóm hiện tại)
          const otherRead = (f.readableByGroups ?? []).filter((id) => id !== groupId).length;
          const otherWrite = (f.writableByGroups ?? []).filter((id) => id !== groupId).length;
          const restricted =
            (f.readableByGroups?.length ?? 0) > 0 || (f.writableByGroups?.length ?? 0) > 0;
          return (
            <div
              key={f.name}
              className={cn(
                "grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2 border-b border-border/50 items-center",
                dirty ? "bg-accent/5" : "hover:bg-hover/30",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm truncate">{f.label || f.name}</span>
                  {restricted && !r && !w && (
                    <span className="text-[9px] px-1 rounded bg-warning/15 text-warning shrink-0">
                      hạn chế
                    </span>
                  )}
                  {dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                </div>
                <span className="text-[10px] text-muted/60 font-mono">{f.name}</span>
              </div>

              {/* Type */}
              <span className="w-16 text-center text-[10px] text-muted/60 bg-bg-soft px-1.5 py-0.5 rounded font-mono truncate">
                {f.type}
              </span>

              {/* Read */}
              <div className="w-10 flex flex-col items-center gap-0.5">
                <input
                  type="checkbox"
                  checked={r}
                  onChange={(e) => toggle(f, "read", e.target.checked)}
                  className="w-3.5 h-3.5 accent-accent"
                />
                {otherRead > 0 && (
                  <span className="text-[9px] text-muted/50 tabular-nums">+{otherRead}</span>
                )}
              </div>

              {/* Write */}
              <div className="w-10 flex flex-col items-center gap-0.5">
                <input
                  type="checkbox"
                  checked={w}
                  onChange={(e) => toggle(f, "write", e.target.checked)}
                  className="w-3.5 h-3.5 accent-accent"
                />
                {otherWrite > 0 && (
                  <span className="text-[9px] text-muted/50 tabular-nums">+{otherWrite}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="shrink-0 px-3 py-1.5 border-t border-border bg-bg-soft/30">
        <p className="text-[10px] text-muted/50 leading-relaxed">
          Tích = nhóm này nằm trong danh sách cho phép.&nbsp; Trống = mọi nhóm đều được.&nbsp;
          <strong>+N</strong> = N nhóm khác cũng được phép.&nbsp;Admin luôn bypass.
        </p>
      </div>
    </div>
  );
}

/* ── ActionButtonPermissionsTab ─────────────────────────── */
/** Tab "Phân quyền nút" trong GroupDetail: chọn trang → liệt kê
 *  nút → toggle visibleToGroups per nhóm.  */
function ActionButtonPermissionsTab({
  group,
  allPages,
}: {
  group: { id: string; name: string; pageIds: string[] };
  allPages: { id: string; name: string }[];
}) {
  const pageContent = useUserObjects((s) => s.pageContent);
  const setPageContent = useUserObjects((s) => s.setPageContent);

  const groupPageSet = useMemo(() => new Set(group.pageIds), [group.pageIds]);

  /* Tùy chọn picker: trang đã gán nhóm lên trước, chưa gán xuống sau. */
  const pageOptions = useMemo<SearchableSelectOption[]>(() => {
    const assigned = allPages
      .filter((p) => groupPageSet.has(p.id))
      .map((p) => ({ value: p.id, label: p.name, searchText: p.name }));
    const unassigned = allPages
      .filter((p) => !groupPageSet.has(p.id))
      .map((p) => ({ value: p.id, label: p.name }));
    return [...assigned, ...unassigned];
  }, [allPages, groupPageSet]);

  /* Trang đang chọn — mặc định trang đầu tiên của nhóm. */
  const [selPageId, setSelPageId] = useState<string>(() => group.pageIds[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  /* Reset khi đổi nhóm. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset khi đổi nhóm
  useEffect(() => {
    setSelPageId(group.pageIds[0] ?? "");
    setSavedMsg("");
  }, [group.id]);

  /* Trích nút hành động từ content trang đang chọn (đã có trong store). */
  const rawContent = selPageId ? pageContent[selPageId] : undefined;
  const actions = useMemo(() => extractPageActions(rawContent), [rawContent]);

  const toggleGroup = async (entry: ActionEntry, turnOn: boolean) => {
    if (!selPageId) return;

    /* Nếu nút đang "Mọi nhóm" (chưa có allowlist) mà BẬT → tạo allowlist mới
     *  → nhóm khác mất nút → cảnh báo xác nhận. */
    const noExistingList = !entry.visibleToGroups || entry.visibleToGroups.length === 0;
    if (turnOn && noExistingList) {
      const ok = await dialog.confirm(
        `Nút "${entry.label}" hiện không giới hạn — mọi nhóm đều thấy. Xác nhận sẽ TẠO danh sách hạn chế: CHỈ nhóm "${group.name}" thấy nút này, các nhóm KHÁC sẽ MẤT nút.`,
        { title: "Giới hạn hiển thị nút", confirmText: "Tiếp tục", danger: true },
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const newContent = applyGroupToggle(rawContent, entry, group.id, turnOn);
      /* setPageContent: cập nhật store đồng bộ + fire-and-forget save backend. */
      setPageContent(selPageId, newContent);
      setSavedMsg("Đã lưu");
      setTimeout(() => setSavedMsg(""), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Picker trang */}
      <div className="px-3 pt-3 pb-2 border-b border-border shrink-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted shrink-0">Trang:</span>
          <div className="flex-1">
            <SearchableSelect
              value={selPageId}
              onChange={setSelPageId}
              options={pageOptions}
              placeholder="— chọn trang —"
              emptyOption="— chọn trang —"
              triggerClassName="h-7! text-xs!"
            />
          </div>
          {savedMsg && <span className="text-[11px] text-success shrink-0">{savedMsg}</span>}
        </div>
        {/* Gợi ý khi chọn trang chưa gán nhóm */}
        {selPageId && !groupPageSet.has(selPageId) && (
          <p className="text-[10px] text-warning/80 leading-relaxed">
            Trang này chưa gán nhóm — thành viên nhóm có thể chưa thấy trang.
          </p>
        )}
      </div>

      {/* Danh sách nút */}
      <div className="flex-1 overflow-y-auto">
        {!selPageId ? (
          <div className="text-xs text-muted/60 text-center py-10">
            Chọn trang để xem nút hành động.
          </div>
        ) : actions.length === 0 ? (
          <div className="text-xs text-muted/60 text-center py-10">
            Trang này chưa có nút hành động nào.
          </div>
        ) : (
          <>
            {/* Header cột */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 px-3 py-1.5 border-b border-border sticky top-0 bg-bg-soft/80 backdrop-blur-sm">
              <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide">
                Nút hành động
              </span>
              <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-20 text-center">
                Hạn chế
              </span>
              <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-12 text-center">
                Thấy
              </span>
            </div>

            {actions.map((entry) => {
              const noGroups = !entry.visibleToGroups || entry.visibleToGroups.length === 0;
              const noUsers = !entry.visibleToUsers || entry.visibleToUsers.length === 0;
              const inGroupList = !noGroups && (entry.visibleToGroups?.includes(group.id) ?? false);
              /* BUG FIX: chỉ CHECKED khi nhóm này THỰC SỰ trong allowlist.
               *  Trước: isOn = noGroups || inGroupList → nút "Mọi nhóm" luôn checked
               *  → bỏ tích = NO-OP (xoá khỏi list rỗng không làm gì). */
              const isOn = inGroupList;
              /* Hạn chế nếu có BẤT KỲ danh sách nào (nhóm hoặc tài khoản). */
              const noRestriction = noGroups && noUsers;

              return (
                <div
                  key={`${entry.compId}-${entry.arrayKey}-${entry.index}`}
                  className="grid grid-cols-[1fr_auto_auto] gap-x-2 px-3 py-2.5 border-b border-border/50 items-center hover:bg-hover/30"
                >
                  {/* Nhãn nút + info widget */}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate leading-tight">{entry.label}</div>
                    <div className="text-[10px] text-muted/60 truncate leading-tight">
                      {entry.compKind} · {entry.compLabel}
                    </div>
                  </div>

                  {/* Badge trạng thái hạn chế — phản ánh cả nhóm lẫn tài khoản. */}
                  <div className="w-20 flex items-center justify-center">
                    {noRestriction ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-success/15 text-success font-medium whitespace-nowrap">
                        Mọi người
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium whitespace-nowrap">
                        Hạn chế
                      </span>
                    )}
                  </div>

                  {/* Toggle nhóm thấy/không thấy nút */}
                  <div className="w-12 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={saving}
                      title={
                        noRestriction
                          ? "Bật để giới hạn chỉ nhóm này (nhóm khác sẽ mất nút)"
                          : isOn
                            ? "Tắt để loại nhóm này khỏi danh sách cho phép"
                            : "Bật để thêm nhóm này vào danh sách cho phép"
                      }
                      onChange={(e) => void toggleGroup(entry, e.target.checked)}
                      className="w-3.5 h-3.5 accent-accent"
                    />
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Footer ghi chú nghiệp vụ */}
      <div className="shrink-0 px-3 py-1.5 border-t border-border bg-bg-soft/30">
        <p className="text-[10px] text-muted/50 leading-relaxed">
          Tích = nhóm này thấy nút.&nbsp;
          <strong>Mọi người</strong> = chưa giới hạn gì (mọi nhóm + mọi tài khoản đều thấy).&nbsp;
          <strong>Hạn chế</strong> = đã có danh sách nhóm hoặc tài khoản.&nbsp; Tích lần đầu tạo
          allowlist nhóm — cần xác nhận.&nbsp; Quyền tài khoản cá nhân cài ở tab "Tài khoản".&nbsp;
          Admin/editor luôn thấy mọi nút.
        </p>
      </div>
    </div>
  );
}

/* ── GroupDetail (cột phải) ───────────────────────────────── */
function GroupDetail({
  group,
  allMembers,
  allPages,
  allGroups,
  onDeleted,
}: {
  group: { id: string; name: string; color: string; memberIds: string[]; pageIds: string[] };
  allMembers: CompanyMember[];
  allPages: { id: string; name: string }[];
  allGroups: { id: string; name: string; color: string; memberIds: string[]; pageIds: string[] }[];
  onDeleted: () => void;
}) {
  const hydrate = useUserObjects((s) => s.hydrate);

  /* ── Tab ── */
  const [tab, setTab] = useState<"members" | "pages" | "actions" | "fields" | "meta">("members");

  /* ── Rename / color ── */
  const [editName, setEditName] = useState(group.name);
  const [editColor, setEditColor] = useState(group.color);
  const [savingMeta, setSavingMeta] = useState(false);
  const metaDirty = editName.trim() !== group.name || editColor !== group.color;

  // Reset khi chuyển group
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on group change
  useEffect(() => {
    setEditName(group.name);
    setEditColor(group.color);
    setTab("members");
  }, [group.id]);

  const handleSaveMeta = async () => {
    if (!editName.trim()) return;
    setSavingMeta(true);
    try {
      await api.viewerGroups.rename(group.id, editName.trim(), editColor);
      await hydrate();
    } finally {
      setSavingMeta(false);
    }
  };

  const handleDelete = async () => {
    const ok = await dialog.confirm(`Xóa nhóm "${group.name}"? Không thể hoàn tác.`, {
      title: "Xóa nhóm",
      confirmText: "Xóa",
      danger: true,
    });
    if (!ok) return;
    await api.viewerGroups.delete(group.id);
    await hydrate();
    onDeleted();
  };

  /* ── Members ── */
  const [memberSearch, setMemberSearch] = useState("");
  const [memberFilter, setMemberFilter] = useState<"all" | "in" | "out">("all");
  const [savingMember, setSavingMember] = useState(false);

  const memberSet = useMemo(() => new Set(group.memberIds), [group.memberIds]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.toLowerCase();
    return allMembers.filter((m) => {
      if (memberFilter === "in" && !memberSet.has(m.userId)) return false;
      if (memberFilter === "out" && memberSet.has(m.userId)) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
    });
  }, [allMembers, memberSearch, memberFilter, memberSet]);

  const toggleMember = async (userId: string) => {
    setSavingMember(true);
    try {
      const next = memberSet.has(userId)
        ? group.memberIds.filter((id) => id !== userId)
        : [...group.memberIds, userId];
      await api.viewerGroups.setMembers(group.id, next);
      await hydrate();
    } finally {
      setSavingMember(false);
    }
  };

  /* ── Pages ── */
  const [pageSearch, setPageSearch] = useState("");
  const [savingPage, setSavingPage] = useState(false);

  const groupPageSet = useMemo(() => new Set(group.pageIds), [group.pageIds]);

  // Tính groups-per-page từ allGroups (để setPageGroups đúng)
  const pageToGroups = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const g of allGroups) {
      for (const pid of g.pageIds) {
        if (!m.has(pid)) m.set(pid, new Set());
        m.get(pid)?.add(g.id);
      }
    }
    return m;
  }, [allGroups]);

  const assignedPages = useMemo(() => {
    const q = pageSearch.toLowerCase();
    return allPages.filter(
      (p) => groupPageSet.has(p.id) && (!q || p.name.toLowerCase().includes(q)),
    );
  }, [allPages, groupPageSet, pageSearch]);

  const unassignedPages = useMemo(() => {
    const q = pageSearch.toLowerCase();
    return allPages.filter(
      (p) => !groupPageSet.has(p.id) && (!q || p.name.toLowerCase().includes(q)),
    );
  }, [allPages, groupPageSet, pageSearch]);

  const togglePage = async (pageId: string, adding: boolean) => {
    setSavingPage(true);
    try {
      const currentGroups = pageToGroups.get(pageId) ?? new Set<string>();
      const nextGroups = adding
        ? [...currentGroups, group.id]
        : [...currentGroups].filter((gid) => gid !== group.id);
      await api.viewerGroups.setPageGroups(pageId, nextGroups);
      await hydrate();
    } finally {
      setSavingPage(false);
    }
  };

  /* ── Render ── */
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header + Tab bar — 1 dòng compact */}
      <div className="border-b border-border shrink-0 flex items-center px-2 gap-1">
        <span
          className="w-2 h-2 rounded-full shrink-0 ml-1"
          style={{ backgroundColor: group.color }}
        />
        <span className="text-xs font-semibold truncate text-text/80 mr-1">{group.name}</span>
        {(
          [
            { key: "members", label: "Thành viên", count: group.memberIds.length },
            { key: "pages", label: "Trang được phép", count: group.pageIds.length },
            { key: "actions", label: "Phân quyền nút", count: null },
            { key: "fields", label: "Quyền trường", count: null },
            { key: "meta", label: "Cài đặt", count: null },
          ] as const
        ).map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "px-2.5 py-1.5 text-[11px] transition-colors border-b-2 -mb-px flex items-center gap-0.5",
              tab === key
                ? "border-accent text-accent font-medium"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {label}
            {count !== null && (
              <span className="text-[10px] opacity-60 tabular-nums">({count})</span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="ml-auto flex items-center gap-0.5 text-[11px] text-muted/50 hover:text-danger transition-colors shrink-0 py-1.5 px-1"
        >
          <I.Trash size={10} />
        </button>
      </div>

      {/* Tab content — full width */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* ── Tab: Thành viên ── */}
        {tab === "members" && (
          <>
            <div className="px-4 pt-3 pb-2 space-y-2 border-b border-border shrink-0">
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Tìm tên, tài khoản…"
                className="text-xs"
              />
              <div className="flex gap-1">
                {(["all", "in", "out"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setMemberFilter(f)}
                    className={cn(
                      "px-2.5 py-0.5 rounded text-[11px] transition-colors",
                      memberFilter === f
                        ? "bg-accent text-white"
                        : "bg-bg-soft hover:bg-hover text-muted",
                    )}
                  >
                    {f === "all"
                      ? `Tất cả (${allMembers.length})`
                      : f === "in"
                        ? `Trong nhóm (${group.memberIds.length})`
                        : "Ngoài nhóm"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
              {filteredMembers.length === 0 ? (
                <div className="text-xs text-muted/60 text-center py-6">Không tìm thấy.</div>
              ) : (
                filteredMembers.map((m) => {
                  const inGroup = memberSet.has(m.userId);
                  return (
                    <label
                      key={m.userId}
                      className={cn(
                        "flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors select-none",
                        inGroup ? "bg-accent/8 hover:bg-accent/12" : "hover:bg-hover",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={inGroup}
                        disabled={savingMember}
                        onChange={() => void toggleMember(m.userId)}
                        className="w-3.5 h-3.5 accent-accent shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate leading-tight">
                          {m.name || m.email}
                        </div>
                        <div className="text-[11px] text-muted truncate leading-tight">
                          {m.email}
                        </div>
                      </div>
                      {inGroup && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />}
                    </label>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ── Tab: Trang được phép ── */}
        {tab === "pages" && (
          <>
            <div className="px-4 pt-3 pb-2 border-b border-border shrink-0">
              <Input
                value={pageSearch}
                onChange={(e) => setPageSearch(e.target.value)}
                placeholder="Tìm tên trang…"
                className="text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {assignedPages.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide mb-1 px-1">
                    Đã gán ({assignedPages.length})
                  </div>
                  <div className="space-y-0.5">
                    {assignedPages.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-accent/8 group"
                      >
                        <I.Layout size={11} className="text-accent shrink-0" />
                        <span className="flex-1 text-sm truncate">{p.name}</span>
                        <button
                          type="button"
                          disabled={savingPage}
                          onClick={() => void togglePage(p.id, false)}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-all"
                          title="Gỡ khỏi nhóm"
                        >
                          <I.X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {unassignedPages.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide mb-1 px-1">
                    Chưa gán (
                    {pageSearch ? unassignedPages.length : allPages.length - group.pageIds.length})
                  </div>
                  <div className="space-y-0.5">
                    {unassignedPages.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover group"
                      >
                        <I.Layout size={11} className="text-muted shrink-0" />
                        <span className="flex-1 text-sm truncate text-muted/80">{p.name}</span>
                        <button
                          type="button"
                          disabled={savingPage}
                          onClick={() => void togglePage(p.id, true)}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all"
                          title="Thêm vào nhóm"
                        >
                          <I.Plus size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {assignedPages.length === 0 && unassignedPages.length === 0 && (
                <div className="text-xs text-muted/60 text-center py-6">Không tìm thấy trang.</div>
              )}
            </div>
          </>
        )}

        {/* ── Tab: Phân quyền nút hành động ── */}
        {tab === "actions" && <ActionButtonPermissionsTab group={group} allPages={allPages} />}

        {/* ── Tab: Quyền trường ── */}
        {tab === "fields" && <FieldPermissionsTab groupId={group.id} />}

        {/* ── Tab: Cài đặt ── */}
        {tab === "meta" && (
          <div className="px-5 py-4 flex flex-col gap-4 max-w-sm">
            <div>
              <label className="block text-xs text-muted mb-1.5">Tên nhóm</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveMeta();
                }}
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Màu nhận diện</label>
              <ColorPicker value={editColor} onChange={setEditColor} />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSaveMeta()}
              disabled={savingMeta || !metaDirty || !editName.trim()}
            >
              {savingMeta ? "Đang lưu…" : "Lưu thay đổi"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── UserFieldPermissionsTab ──────────────────────────────── */
function UserFieldPermissionsTab({ userId }: { userId: string }) {
  const entities = useUserObjects((s) => s.entities);
  const hydrate = useUserObjects((s) => s.hydrate);

  const entityList = useMemo(
    () =>
      entities
        .filter((e) => e.fields.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    [entities],
  );

  const [selId, setSelId] = useState<string>(() => entityList[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Record<string, { read: boolean; write: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const selEntity = entityList.find((e) => e.id === selId) ?? entityList[0] ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on entity switch
  useEffect(() => {
    setPending({});
    setSavedMsg("");
  }, [selId]);

  useEffect(() => {
    if (!selId && entityList.length > 0) setSelId(entityList[0]?.id ?? "");
  }, [entityList, selId]);

  const getRead = (f: EntityField) =>
    f.name in pending
      ? (pending[f.name]?.read ?? false)
      : (f.readableByUsers?.includes(userId) ?? false);

  const getWrite = (f: EntityField) =>
    f.name in pending
      ? (pending[f.name]?.write ?? false)
      : (f.writableByUsers?.includes(userId) ?? false);

  const toggle = (f: EntityField, key: "read" | "write", val: boolean) => {
    setPending((p) => ({
      ...p,
      [f.name]: { read: getRead(f), write: getWrite(f), [key]: val },
    }));
  };

  const hasPending = Object.keys(pending).length > 0;

  const handleSave = async () => {
    if (!selEntity || !hasPending) return;
    setSaving(true);
    try {
      const updatedFields = selEntity.fields.map((f) => {
        if (!(f.name in pending)) return f;
        const { read, write } = pending[f.name] ?? { read: false, write: false };
        const ru = read
          ? [...new Set([...(f.readableByUsers ?? []), userId])]
          : (f.readableByUsers ?? []).filter((id) => id !== userId);
        const wu = write
          ? [...new Set([...(f.writableByUsers ?? []), userId])]
          : (f.writableByUsers ?? []).filter((id) => id !== userId);
        return {
          ...f,
          readableByUsers: ru.length > 0 ? ru : undefined,
          writableByUsers: wu.length > 0 ? wu : undefined,
        };
      });
      await api.entities.save({
        id: selEntity.id,
        name: selEntity.techName?.trim() || selEntity.name,
        label: selEntity.name,
        icon: selEntity.icon,
        fields: updatedFields,
        meta: {},
      });
      await hydrate();
      setPending({});
      setSavedMsg("Đã lưu");
      setTimeout(() => setSavedMsg(""), 2500);
    } finally {
      setSaving(false);
    }
  };

  const filteredFields = useMemo(() => {
    if (!selEntity) return [];
    const q = search.toLowerCase();
    return selEntity.fields.filter(
      (f) => !q || f.name.toLowerCase().includes(q) || f.label?.toLowerCase().includes(q),
    );
  }, [selEntity, search]);

  if (entityList.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted/60">
        Chưa có thực thể nào.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-3 pt-3 pb-2 border-b border-border shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted shrink-0">Thực thể:</span>
          <select
            value={selId}
            onChange={(e) => setSelId(e.target.value)}
            className="flex-1 text-xs border border-border rounded px-2 py-1 bg-bg text-text focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {entityList.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          {savedMsg && <span className="text-[11px] text-success shrink-0">{savedMsg}</span>}
          <Button
            variant="primary"
            size="sm"
            disabled={!hasPending || saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm trường…"
          className="text-xs"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 border-b border-border sticky top-0 bg-bg-soft/80 backdrop-blur-sm">
          <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide">
            Trường
          </span>
          <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-16 text-center">
            Kiểu
          </span>
          <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-10 text-center">
            Đọc
          </span>
          <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-10 text-center">
            Ghi
          </span>
        </div>
        {filteredFields.length === 0 && (
          <div className="text-xs text-muted/60 text-center py-6">Không tìm thấy trường nào.</div>
        )}
        {filteredFields.map((f) => {
          const r = getRead(f);
          const w = getWrite(f);
          const dirty = f.name in pending;
          // Chỉ có hiệu lực khi field đang bị hạn chế nhóm
          const groupRestricted =
            (f.readableByGroups?.length ?? 0) > 0 || (f.writableByGroups?.length ?? 0) > 0;
          return (
            <div
              key={f.name}
              className={cn(
                "grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2 border-b border-border/50 items-center",
                dirty ? "bg-accent/5" : "hover:bg-hover/30",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm truncate">{f.label || f.name}</span>
                  {groupRestricted && (
                    <span className="text-[9px] px-1 rounded bg-warning/15 text-warning shrink-0">
                      hạn chế nhóm
                    </span>
                  )}
                  {dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                </div>
                <span className="text-[10px] text-muted/60 font-mono">{f.name}</span>
              </div>
              <span className="w-16 text-center text-[10px] text-muted/60 bg-bg-soft px-1.5 py-0.5 rounded font-mono truncate">
                {f.type}
              </span>
              <div className="w-10 flex flex-col items-center gap-0.5">
                <input
                  type="checkbox"
                  checked={r}
                  onChange={(e) => toggle(f, "read", e.target.checked)}
                  className="w-3.5 h-3.5 accent-[hsl(var(--accent))]"
                  title="Cho phép đọc (ưu tiên nhóm)"
                />
              </div>
              <div className="w-10 flex flex-col items-center gap-0.5">
                <input
                  type="checkbox"
                  checked={w}
                  onChange={(e) => toggle(f, "write", e.target.checked)}
                  className="w-3.5 h-3.5 accent-[hsl(var(--accent))]"
                  title="Cho phép ghi (ưu tiên nhóm)"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── UserActionButtonPermissionsTab ─────────────────────── */
/** Tab "Phân quyền nút" trong UserPageAccessPanel: chọn trang → liệt kê
 *  nút → toggle visibleToUsers per tài khoản.  */
function UserActionButtonPermissionsTab({
  user,
  allPages,
}: {
  user: CompanyMember;
  allPages: { id: string; name: string }[];
}) {
  const pageContent = useUserObjects((s) => s.pageContent);
  const setPageContent = useUserObjects((s) => s.setPageContent);

  const pageOptions = useMemo<SearchableSelectOption[]>(
    () => allPages.map((p) => ({ value: p.id, label: p.name, searchText: p.name })),
    [allPages],
  );

  /* Trang đang chọn — mặc định trang đầu tiên trong danh sách. */
  const [selPageId, setSelPageId] = useState<string>(() => allPages[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  /* Reset khi đổi user. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset khi đổi user
  useEffect(() => {
    setSelPageId(allPages[0]?.id ?? "");
    setSavedMsg("");
  }, [user.userId]);

  /* Trích nút hành động từ content trang đang chọn (đã có trong store). */
  const rawContent = selPageId ? pageContent[selPageId] : undefined;
  const actions = useMemo(() => extractPageActions(rawContent), [rawContent]);

  const toggleUser = async (entry: ActionEntry, turnOn: boolean) => {
    if (!selPageId) return;

    /* Nếu nút đang "Mọi người" (chưa có bất kỳ allowlist nào) mà BẬT →
     *  cảnh báo xác nhận trước khi tạo allowlist user. */
    const noExistingGroupList = !entry.visibleToGroups || entry.visibleToGroups.length === 0;
    const noExistingUserList = !entry.visibleToUsers || entry.visibleToUsers.length === 0;
    if (turnOn && noExistingGroupList && noExistingUserList) {
      const ok = await dialog.confirm(
        `Nút "${entry.label}" hiện không giới hạn — mọi người đều thấy. Xác nhận sẽ TẠO danh sách hạn chế tài khoản: CHỈ tài khoản "${user.name || user.email}" thấy nút này (cùng các nhóm được phép, nếu có sau).`,
        { title: "Giới hạn hiển thị nút theo tài khoản", confirmText: "Tiếp tục", danger: true },
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const newContent = applyUserToggle(rawContent, entry, user.userId, turnOn);
      /* setPageContent: cập nhật store (immutable) + fire-and-forget save backend. */
      setPageContent(selPageId, newContent);
      setSavedMsg("Đã lưu");
      setTimeout(() => setSavedMsg(""), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Picker trang */}
      <div className="px-3 pt-3 pb-2 border-b border-border shrink-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted shrink-0">Trang:</span>
          <div className="flex-1">
            <SearchableSelect
              value={selPageId}
              onChange={setSelPageId}
              options={pageOptions}
              placeholder="— chọn trang —"
              emptyOption="— chọn trang —"
              triggerClassName="h-7! text-xs!"
            />
          </div>
          {savedMsg && <span className="text-[11px] text-success shrink-0">{savedMsg}</span>}
        </div>
      </div>

      {/* Danh sách nút */}
      <div className="flex-1 overflow-y-auto">
        {!selPageId ? (
          <div className="text-xs text-muted/60 text-center py-10">
            Chọn trang để xem nút hành động.
          </div>
        ) : actions.length === 0 ? (
          <div className="text-xs text-muted/60 text-center py-10">
            Trang này chưa có nút hành động nào.
          </div>
        ) : (
          <>
            {/* Header cột */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 px-3 py-1.5 border-b border-border sticky top-0 bg-bg-soft/80 backdrop-blur-sm">
              <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide">
                Nút hành động
              </span>
              <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-20 text-center">
                Hạn chế
              </span>
              <span className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide w-12 text-center">
                Thấy
              </span>
            </div>

            {actions.map((entry) => {
              const noGroups = !entry.visibleToGroups || entry.visibleToGroups.length === 0;
              const noUsers = !entry.visibleToUsers || entry.visibleToUsers.length === 0;
              const inUserList = !noUsers && (entry.visibleToUsers?.includes(user.userId) ?? false);
              /* Chỉ CHECKED khi user này THỰC SỰ trong visibleToUsers. */
              const isOn = inUserList;
              /* Hạn chế nếu có BẤT KỲ danh sách nào (nhóm hoặc tài khoản). */
              const noRestriction = noGroups && noUsers;

              return (
                <div
                  key={`${entry.compId}-${entry.arrayKey}-${entry.index}`}
                  className="grid grid-cols-[1fr_auto_auto] gap-x-2 px-3 py-2.5 border-b border-border/50 items-center hover:bg-hover/30"
                >
                  {/* Nhãn nút + info widget */}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate leading-tight">{entry.label}</div>
                    <div className="text-[10px] text-muted/60 truncate leading-tight">
                      {entry.compKind} · {entry.compLabel}
                    </div>
                  </div>

                  {/* Badge trạng thái — phản ánh cả nhóm lẫn tài khoản. */}
                  <div className="w-20 flex items-center justify-center">
                    {noRestriction ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-success/15 text-success font-medium whitespace-nowrap">
                        Mọi người
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium whitespace-nowrap">
                        Hạn chế
                      </span>
                    )}
                  </div>

                  {/* Toggle tài khoản thấy nút */}
                  <div className="w-12 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={saving}
                      title={
                        noRestriction
                          ? "Bật để giới hạn riêng tài khoản này (tạo allowlist user)"
                          : isOn
                            ? "Tắt để loại tài khoản này khỏi danh sách được phép"
                            : "Bật để thêm tài khoản này vào danh sách được phép"
                      }
                      onChange={(e) => void toggleUser(entry, e.target.checked)}
                      className="w-3.5 h-3.5 accent-accent"
                    />
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Footer ghi chú nghiệp vụ */}
      <div className="shrink-0 px-3 py-1.5 border-t border-border bg-bg-soft/30">
        <p className="text-[10px] text-muted/50 leading-relaxed">
          Tích = tài khoản này thấy nút (ưu tiên: thấy kể cả không thuộc nhóm được phép).&nbsp;
          <strong>Mọi người</strong> = chưa giới hạn gì.&nbsp;
          <strong>Hạn chế</strong> = đã có danh sách nhóm hoặc tài khoản.&nbsp; Tích lần đầu tạo
          allowlist user — cần xác nhận.&nbsp; Quyền nhóm cài ở tab "Nhóm" phần "Phân quyền
          nút".&nbsp; Admin/editor luôn thấy mọi nút.
        </p>
      </div>
    </div>
  );
}

/* ── UserPageAccessPanel (cột phải khi chọn user ở tab Tài khoản) ── */
function UserPageAccessPanel({
  user,
  allPages,
  onClose,
}: {
  user: CompanyMember;
  allPages: { id: string; name: string }[];
  onClose: () => void;
}) {
  const hydrate = useUserObjects((s) => s.hydrate);
  const [tab, setTab] = useState<"pages" | "actions" | "fields">("pages");
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageSearch, setPageSearch] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: load on user change
  useEffect(() => {
    setLoading(true);
    setTab("pages");
    api.viewerGroups
      .listUserPageAccess()
      .then((rows) => {
        const row = rows.find((r) => r.userId === user.userId);
        setPageIds(row?.pageIds ?? []);
      })
      .catch(() => setPageIds([]))
      .finally(() => setLoading(false));
  }, [user.userId]);

  const togglePage = async (pageId: string, add: boolean) => {
    const next = add ? [...pageIds, pageId] : pageIds.filter((id) => id !== pageId);
    setPageIds(next);
    setSaving(true);
    try {
      await api.viewerGroups.setUserPages(user.userId, next);
      await hydrate();
    } finally {
      setSaving(false);
    }
  };

  const q = pageSearch.toLowerCase();
  const assignedPages = allPages.filter(
    (p) => pageIds.includes(p.id) && p.name.toLowerCase().includes(q),
  );
  const unassignedPages = allPages.filter(
    (p) => !pageIds.includes(p.id) && p.name.toLowerCase().includes(q),
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header + tab bar */}
      <div className="border-b border-border shrink-0 flex items-center px-3 py-0 gap-2">
        <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0 my-1.5">
          <I.User size={13} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0 py-1">
          <div className="text-xs font-semibold truncate">{user.name || user.email}</div>
          <div className="text-[10px] text-muted truncate">{user.email}</div>
        </div>
        {(
          [
            { key: "pages", label: "Trang" },
            { key: "actions", label: "Phân quyền nút" },
            { key: "fields", label: "Quyền trường" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "px-2.5 py-1.5 text-[11px] border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-accent text-accent font-medium"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="text-muted/50 hover:text-text transition-colors shrink-0 p-1"
          title="Đóng"
        >
          <I.X size={13} />
        </button>
      </div>

      {/* Tab: Trang */}
      {tab === "pages" && (
        <>
          <div className="px-3 py-1.5 bg-accent/5 border-b border-border text-[11px] text-muted shrink-0">
            Trang được cấp quyền cá nhân — hiển thị dù không thuộc nhóm nào.
          </div>
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted/60">
              Đang tải…
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-border shrink-0">
                <Input
                  value={pageSearch}
                  onChange={(e) => setPageSearch(e.target.value)}
                  placeholder="Tìm trang…"
                  className="text-xs"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
                {assignedPages.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide mb-1 px-1">
                      Đã cấp ({pageIds.length})
                    </div>
                    <div className="space-y-0.5">
                      {assignedPages.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-accent/8 group"
                        >
                          <I.Layout size={11} className="text-accent shrink-0" />
                          <span className="flex-1 text-sm truncate">{p.name}</span>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void togglePage(p.id, false)}
                            className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-all"
                            title="Gỡ quyền"
                          >
                            <I.X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {unassignedPages.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide mb-1 px-1">
                      Chưa cấp (
                      {pageSearch ? unassignedPages.length : allPages.length - pageIds.length})
                    </div>
                    <div className="space-y-0.5">
                      {unassignedPages.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover group"
                        >
                          <I.Layout size={11} className="text-muted shrink-0" />
                          <span className="flex-1 text-sm truncate text-muted/80">{p.name}</span>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void togglePage(p.id, true)}
                            className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all"
                            title="Cấp quyền"
                          >
                            <I.Plus size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {assignedPages.length === 0 && unassignedPages.length === 0 && (
                  <div className="text-xs text-muted/60 text-center py-6">
                    Không tìm thấy trang.
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Tab: Phân quyền nút hành động theo tài khoản */}
      {tab === "actions" && <UserActionButtonPermissionsTab user={user} allPages={allPages} />}

      {/* Tab: Quyền trường */}
      {tab === "fields" && <UserFieldPermissionsTab userId={user.userId} />}
    </div>
  );
}

/* ── UserAccessTab (nội dung tab Tài khoản) ────────────────── */
function UserAccessTab({
  members,
  allPages,
}: {
  members: CompanyMember[];
  allPages: { id: string; name: string }[];
}) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [accessMap, setAccessMap] = useState<Record<string, number>>({});

  // Load so trang da cap cho moi user
  useEffect(() => {
    api.viewerGroups
      .listUserPageAccess()
      .then((rows) => {
        const map: Record<string, number> = {};
        for (const r of rows) map[r.userId] = r.pageIds.length;
        setAccessMap(map);
      })
      .catch(() => {});
  }, []);

  const selectedUser = members.find((m) => m.userId === selectedUserId) ?? null;

  const q = memberSearch.toLowerCase();
  const filteredMembers = members.filter(
    (m) =>
      m.role !== "admin" &&
      m.role !== "editor" &&
      (m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Cot trai: danh sach viewer */}
      <div className="w-56 shrink-0 flex flex-col border-r border-border">
        <div className="px-3 py-1.5 border-b border-border shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted/60 mb-1.5">
            Tài khoản viewer
          </div>
          <Input
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            placeholder="Tìm…"
            className="text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filteredMembers.length === 0 ? (
            <div className="text-xs text-muted/60 text-center py-6">Không có viewer nào.</div>
          ) : (
            filteredMembers.map((m) => {
              const count = accessMap[m.userId] ?? 0;
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => setSelectedUserId(m.userId)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                    m.userId === selectedUserId
                      ? "bg-accent/10 text-text"
                      : "hover:bg-hover text-muted",
                  )}
                >
                  <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <I.User size={11} className="text-accent" />
                  </div>
                  <span className="flex-1 text-xs truncate">{m.name || m.email}</span>
                  {count > 0 && (
                    <span className="text-[10px] text-accent tabular-nums shrink-0">{count}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Cot phai: quyen trang cua user da chon */}
      <div className="flex-1 flex overflow-hidden">
        {selectedUser ? (
          <UserPageAccessPanel
            user={selectedUser}
            allPages={allPages}
            onClose={() => setSelectedUserId(null)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted/60">
            <I.User size={28} className="opacity-30" />
            <div className="text-sm">Chọn tài khoản để cấp quyền trang</div>
            <div className="text-xs text-center max-w-[220px] opacity-70">
              Quyền cá nhân ưu tiên nhóm: viewer thấy trang kể cả khi không thuộc nhóm nào.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────── */
function ViewerGroupsSettings() {
  const viewerGroupsList = useUserObjects((s) => s.viewerGroupsList);
  const pages = useUserObjects((s) => s.pages);

  const [mainTab, setMainTab] = useState<"groups" | "accounts">("groups");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [members, setMembers] = useState<CompanyMember[]>([]);

  useEffect(() => {
    companiesApi
      .members()
      .then((rows) =>
        setMembers(
          rows.map((r) => ({ userId: r.userId, email: r.email, name: r.name, role: r.role })),
        ),
      )
      .catch(() => {});
  }, []);

  // Chọn group đầu tiên khi load xong
  // biome-ignore lint/correctness/useExhaustiveDependencies: select first on init
  useEffect(() => {
    if (!selectedId && !creatingNew && viewerGroupsList.length > 0) {
      setSelectedId(viewerGroupsList[0]?.id ?? "");
    }
  }, [viewerGroupsList.length]);

  const selectedGroup = viewerGroupsList.find((g) => g.id === selectedId) ?? null;

  // Hiển thị tất cả pages (admin gán group cho cả draft lẫn published)
  const allPagesFlat = useMemo(() => pages.map((p) => ({ id: p.id, name: p.name })), [pages]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Page header + tab bar chinh */}
      <div className="px-4 py-0 border-b border-border shrink-0 flex items-center gap-0">
        <h1 className="text-xs font-semibold mr-4">Nhóm người xem</h1>
        {(
          [
            { key: "groups", label: "Nhóm" },
            { key: "accounts", label: "Tài khoản" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMainTab(key)}
            className={cn(
              "px-3 py-2 text-xs border-b-2 -mb-px transition-colors",
              mainTab === key
                ? "border-accent text-accent font-medium"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Body: 2 cột */}
      <div className="flex-1 flex overflow-hidden">
        {mainTab === "accounts" ? (
          <UserAccessTab members={members} allPages={allPagesFlat} />
        ) : (
          <>
            {/* Cột trái: danh sách nhóm */}
            <div className="w-56 shrink-0 flex flex-col">
              <GroupList
                groups={viewerGroupsList}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setCreatingNew(false);
                }}
                onNew={() => {
                  setCreatingNew(true);
                  setSelectedId(null);
                }}
              />
            </div>

            {/* Cột phải: detail */}
            <div className="flex-1 flex overflow-hidden">
              {creatingNew ? (
                <NewGroupPanel
                  onDone={() => {
                    setCreatingNew(false);
                    if (viewerGroupsList.length > 0)
                      setSelectedId(viewerGroupsList.at(-1)?.id ?? "");
                  }}
                />
              ) : selectedGroup ? (
                <GroupDetail
                  group={selectedGroup}
                  allMembers={members}
                  allPages={allPagesFlat}
                  allGroups={viewerGroupsList}
                  onDeleted={() => {
                    setSelectedId(
                      viewerGroupsList.find((g) => g.id !== selectedGroup.id)?.id ?? null,
                    );
                  }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-muted/60">
                  Chọn nhóm để xem chi tiết
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/viewer-groups")({
  component: ViewerGroupsSettings,
});
