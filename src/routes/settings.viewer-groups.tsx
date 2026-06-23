/* ==========================================================
   settings.viewer-groups.tsx — Quản lý nhóm người xem.
   Layout master-detail: cột trái = danh sách nhóm,
   cột phải = chỉnh sửa nhóm đang chọn (thành viên + trang).
   ========================================================== */

import { createCompaniesClient, createObjectsClient } from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

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
      <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted/70">Nhóm</span>
        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
        >
          <I.Plus size={12} />
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
  const [color, setColor] = useState(PRESET_COLORS[0]);
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
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold">Tạo nhóm mới</h2>
      </div>
      <div className="px-6 py-5 flex flex-col gap-4 max-w-sm">
        <div>
          <label className="block text-xs text-muted mb-1.5">Tên nhóm</label>
          <Input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Kinh doanh, Kỹ thuật…"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
            }}
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
        m.get(pid)!.add(g.id);
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
      {/* Header group */}
      <div className="px-6 py-3 border-b border-border shrink-0 flex items-center gap-3">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: editColor }} />
        <span className="flex-1 text-sm font-semibold truncate">{group.name}</span>
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="flex items-center gap-1 text-xs text-muted hover:text-danger transition-colors"
        >
          <I.Trash size={12} />
          Xóa nhóm
        </button>
      </div>

      {/* Scrollable body — 2 cột */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 divide-x divide-border min-h-full">
          {/* ── Cột trái: Thành viên ── */}
          <div className="flex flex-col">
            {/* Tên + màu */}
            <div className="px-4 py-3 border-b border-border bg-bg-soft/40">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-[10px] text-muted mb-1">Tên nhóm</label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleSaveMeta()}
                  disabled={savingMeta || !metaDirty || !editName.trim()}
                >
                  Lưu
                </Button>
              </div>
              <div className="mt-2">
                <label className="block text-[10px] text-muted mb-1.5">Màu</label>
                <ColorPicker value={editColor} onChange={setEditColor} />
              </div>
            </div>

            {/* Thanh tìm + filter thành viên */}
            <div className="px-3 pt-3 pb-2 space-y-2 border-b border-border">
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold text-muted/70 uppercase tracking-wide flex-1">
                  Thành viên
                </span>
                <span className="text-[11px] text-muted">
                  {group.memberIds.length} / {allMembers.length}
                </span>
              </div>
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
                      "px-2 py-0.5 rounded text-[11px] transition-colors",
                      memberFilter === f
                        ? "bg-accent text-white"
                        : "bg-bg-soft hover:bg-hover text-muted",
                    )}
                  >
                    {f === "all" ? "Tất cả" : f === "in" ? "Trong nhóm" : "Ngoài nhóm"}
                  </button>
                ))}
              </div>
            </div>

            {/* Danh sách members */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
              {filteredMembers.length === 0 ? (
                <div className="text-xs text-muted/60 text-center py-4">Không tìm thấy.</div>
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
          </div>

          {/* ── Cột phải: Trang ── */}
          <div className="flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-bg-soft/40 space-y-2">
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold text-muted/70 uppercase tracking-wide flex-1">
                  Trang được phép
                </span>
                <span className="text-[11px] text-muted">
                  {group.pageIds.length} / {allPages.length}
                </span>
              </div>
              <Input
                value={pageSearch}
                onChange={(e) => setPageSearch(e.target.value)}
                placeholder="Tìm tên trang…"
                className="text-xs"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2">
              {/* Đã gán */}
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

              {/* Chưa gán */}
              {unassignedPages.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wide mb-1 px-1">
                    Chưa gán {pageSearch ? `(${unassignedPages.length})` : ""}
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
                <div className="text-xs text-muted/60 text-center py-4">Không tìm thấy trang.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────── */
function ViewerGroupsSettings() {
  const viewerGroupsList = useUserObjects((s) => s.viewerGroupsList);
  const pages = useUserObjects((s) => s.pages);

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
      setSelectedId(viewerGroupsList[0].id);
    }
  }, [viewerGroupsList.length]);

  const selectedGroup = viewerGroupsList.find((g) => g.id === selectedId) ?? null;

  const publishedPages = useMemo(
    () => pages.filter((p) => p.published).map((p) => ({ id: p.id, name: p.name })),
    [pages],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-base font-semibold">Nhóm người xem</h1>
        <p className="text-xs text-muted mt-0.5">
          Phân quyền trang portal theo nhóm. Viewer chỉ thấy trang được gán vào nhóm của họ.
        </p>
      </div>

      {/* Body: 2 cột */}
      <div className="flex-1 flex overflow-hidden">
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
                // Chọn group mới nhất sau khi tạo
                if (viewerGroupsList.length > 0)
                  setSelectedId(viewerGroupsList[viewerGroupsList.length - 1].id);
              }}
            />
          ) : selectedGroup ? (
            <GroupDetail
              group={selectedGroup}
              allMembers={members}
              allPages={publishedPages}
              allGroups={viewerGroupsList}
              onDeleted={() => {
                setSelectedId(viewerGroupsList.find((g) => g.id !== selectedGroup.id)?.id ?? null);
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted/60">
              Chọn nhóm để xem chi tiết
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/viewer-groups")({
  component: ViewerGroupsSettings,
});
