/* ==========================================================
   settings.navigation — Trình dựng menu (PA2). Admin sắp xếp page/link
   thành cây nhóm, kéo-thả đổi cha + thứ tự. Render ở Sidebar section "Menu".
   ========================================================== */
import { createNavClient, type NavItem, type NavKind } from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, EmptyState, Input, Select } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { useUserObjects } from "@/stores/userObjects";

const navApi = createNavClient("");

const KIND_LABEL: Record<NavKind, string> = { group: "Nhóm", page: "Trang", link: "Liên kết" };

function kindIcon(kind: NavKind) {
  // Màu loại đối tượng dùng token semantic (đổi theo sáng/tối), KHÔNG palette cứng.
  if (kind === "group") return <I.Folder size={14} className="shrink-0 text-warning" />;
  if (kind === "page") return <I.File size={14} className="shrink-0 text-accent-2" />;
  return <I.Link size={14} className="shrink-0 text-accent" />;
}

function NavBuilderPage() {
  const pages = useUserObjects((s) => s.pages);
  const [items, setItems] = useState<NavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Form thêm item
  const [fKind, setFKind] = useState<NavKind>("group");
  const [fLabel, setFLabel] = useState("");
  const [fTarget, setFTarget] = useState("");
  const [fParent, setFParent] = useState("");

  const load = useCallback(async () => {
    try {
      setItems(await navApi.list());
    } catch (e) {
      await dialog.alert(`Lỗi tải menu: ${(e as Error)?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, NavItem[]>();
    for (const it of items) {
      const k = it.parentId;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    return m;
  }, [items]);

  const groups = useMemo(() => items.filter((i) => i.kind === "group"), [items]);

  const isDescendant = useCallback(
    (ancestorId: string, nodeId: string): boolean => {
      let cur: string | null = nodeId;
      while (cur) {
        if (cur === ancestorId) return true;
        cur = byId.get(cur)?.parentId ?? null;
      }
      return false;
    },
    [byId],
  );

  const addItem = useCallback(async () => {
    if (!fLabel.trim()) {
      await dialog.alert("Nhập nhãn.");
      return;
    }
    if (fKind !== "group" && !fTarget.trim()) {
      await dialog.alert(fKind === "page" ? "Chọn trang." : "Nhập route/URL.");
      return;
    }
    setBusy(true);
    try {
      await navApi.create({
        parentId: fParent || null,
        kind: fKind,
        label: fLabel.trim(),
        target: fKind === "group" ? undefined : fTarget.trim(),
      });
      setFLabel("");
      setFTarget("");
      await load();
    } catch (e) {
      await dialog.alert(`Lỗi thêm: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [fKind, fLabel, fTarget, fParent, load]);

  const doDrop = useCallback(
    async (targetId: string | null) => {
      const id = dragId;
      setDragId(null);
      setDropTarget(null);
      if (!id || id === targetId) return;
      if (targetId && isDescendant(id, targetId)) {
        await dialog.alert("Không thể kéo vào chính nhánh con của nó.");
        return;
      }
      const target = targetId ? byId.get(targetId) : null;
      // Thả lên nhóm → thành con nhóm đó. Thả lên trang/link → thành anh em (cùng cha).
      const newParent = target ? (target.kind === "group" ? target.id : target.parentId) : null;
      const sibs = (childrenOf.get(newParent) ?? []).filter((x) => x.id !== id);
      // sortOrder = max+1 (KHÔNG dùng sibs.length — sortOrder có thể không liên
      // tục sau delete/move → length trùng giá trị đang có).
      const nextOrder = sibs.reduce((mx, s) => Math.max(mx, s.sortOrder), -1) + 1;
      setBusy(true);
      try {
        await navApi.move({ id, parentId: newParent, sortOrder: nextOrder });
        await load();
      } catch (e) {
        await dialog.alert(`Lỗi di chuyển: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusy(false);
      }
    },
    [dragId, byId, childrenOf, isDescendant, load],
  );

  const reorderSibling = useCallback(
    async (item: NavItem, dir: -1 | 1) => {
      const sibs = (childrenOf.get(item.parentId) ?? []).slice();
      const idx = sibs.findIndex((s) => s.id === item.id);
      const swap = idx + dir;
      if (swap < 0 || swap >= sibs.length) return;
      [sibs[idx], sibs[swap]] = [sibs[swap]!, sibs[idx]!];
      setBusy(true);
      try {
        await navApi.reorder(sibs.map((s) => s.id));
        await load();
      } finally {
        setBusy(false);
      }
    },
    [childrenOf, load],
  );

  const rename = useCallback(
    async (item: NavItem) => {
      const v = await dialog.prompt("Đổi nhãn:", item.label);
      if (v == null || !v.trim()) return;
      await navApi.update({ id: item.id, label: v.trim() });
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (item: NavItem) => {
      const kids = childrenOf.get(item.id)?.length ?? 0;
      const ok = await dialog.confirm(
        kids > 0 ? `Xoá "${item.label}" và ${kids} mục con bên trong?` : `Xoá "${item.label}"?`,
      );
      if (!ok) return;
      await navApi.remove(item.id);
      await load();
    },
    [childrenOf, load],
  );

  const renderRow = (item: NavItem, depth: number, seen: Set<string>): ReactElement | null => {
    if (seen.has(item.id) || depth > 50) return null; // phòng cây vòng
    const here = new Set(seen).add(item.id);
    const kids = childrenOf.get(item.id) ?? [];
    const isDrop = dropTarget === item.id;
    return (
      <div key={item.id}>
        <div
          draggable
          onDragStart={() => setDragId(item.id)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragId && dragId !== item.id) setDropTarget(item.id);
          }}
          onDragLeave={() => setDropTarget((t) => (t === item.id ? null : t))}
          onDrop={(e) => {
            e.preventDefault();
            void doDrop(item.id);
          }}
          className={[
            "group flex items-center gap-1.5 rounded px-2 py-1.5 text-sm border",
            isDrop ? "border-accent bg-accent/10" : "border-transparent hover:bg-hover/40",
          ].join(" ")}
          style={{ marginLeft: depth * 20 }}
        >
          <I.List size={13} className="shrink-0 cursor-grab text-muted" />
          {kindIcon(item.kind)}
          <span className="truncate font-medium">{item.label}</span>
          <Chip variant="default" className="text-[9px]!">
            {KIND_LABEL[item.kind]}
          </Chip>
          {item.target && (
            <span className="truncate text-[11px] text-muted font-mono">
              {item.kind === "page" ? "page" : item.target}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
            <button
              type="button"
              title="Lên"
              className="rounded p-1 hover:bg-hover text-muted"
              onClick={() => void reorderSibling(item, -1)}
            >
              <I.ChevronUp size={13} />
            </button>
            <button
              type="button"
              title="Xuống"
              className="rounded p-1 hover:bg-hover text-muted"
              onClick={() => void reorderSibling(item, 1)}
            >
              <I.ChevronDown size={13} />
            </button>
            <button
              type="button"
              title="Đổi nhãn"
              className="rounded p-1 hover:bg-hover text-muted"
              onClick={() => void rename(item)}
            >
              <I.Edit size={13} />
            </button>
            <button
              type="button"
              title="Xoá"
              className="rounded p-1 hover:bg-hover text-danger"
              onClick={() => void remove(item)}
            >
              <I.Trash size={13} />
            </button>
          </div>
        </div>
        {kids.map((c) => renderRow(c, depth + 1, here))}
      </div>
    );
  };

  const roots = childrenOf.get(null) ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-1 flex items-center gap-2">
        <I.List size={18} />
        <h1 className="text-lg font-semibold">Trình dựng menu</h1>
      </div>
      <p className="mb-4 text-sm text-muted">
        Sắp xếp trang/liên kết thành cây nhóm. Kéo-thả 1 mục lên một <strong>nhóm</strong> để đưa
        vào trong; thả lên trang/liên kết để thành anh em. Mũi tên ↑↓ đổi thứ tự. Menu này hiện ở
        thanh bên, mục “Menu”.
      </p>

      {/* Form thêm */}
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-[11px] text-muted">Loại</div>
            <Select
              value={fKind}
              onChange={(e) => {
                setFKind(e.target.value as NavKind);
                setFTarget("");
              }}
              className="w-28"
            >
              <option value="group">Nhóm</option>
              <option value="page">Trang</option>
              <option value="link">Liên kết</option>
            </Select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <div className="mb-1 text-[11px] text-muted">Nhãn</div>
            <Input
              value={fLabel}
              onChange={(e) => setFLabel(e.target.value)}
              placeholder="Tên hiển thị"
            />
          </div>
          {fKind === "page" && (
            <div className="flex-1 min-w-[160px]">
              <div className="mb-1 text-[11px] text-muted">Trang</div>
              <Select value={fTarget} onChange={(e) => setFTarget(e.target.value)}>
                <option value="">— chọn trang —</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {fKind === "link" && (
            <div className="flex-1 min-w-[160px]">
              <div className="mb-1 text-[11px] text-muted">Route / URL</div>
              <Input
                value={fTarget}
                onChange={(e) => setFTarget(e.target.value)}
                placeholder="/entities/... hoặc https://..."
              />
            </div>
          )}
          <div>
            <div className="mb-1 text-[11px] text-muted">Trong nhóm</div>
            <Select value={fParent} onChange={(e) => setFParent(e.target.value)} className="w-40">
              <option value="">(Gốc)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void addItem()}
            icon={<I.Plus size={13} />}
          >
            Thêm
          </Button>
        </div>
      </Card>

      {/* Cây */}
      <Card className="p-3">
        {loading ? (
          <div className="py-6 text-center text-sm text-muted">Đang tải…</div>
        ) : roots.length === 0 ? (
          <EmptyState
            icon={<I.List size={28} />}
            title="Chưa có mục menu"
            hint="Thêm 1 Nhóm rồi kéo các Trang vào trong để dựng cấu trúc."
          />
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void doDrop(null);
            }}
          >
            {roots.map((r) => renderRow(r, 0, new Set()))}
            <div className="mt-1 rounded border border-dashed border-border px-2 py-1.5 text-[11px] text-muted">
              Thả vào đây để đưa ra ngoài cùng (gốc).
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/settings/navigation")({
  component: NavBuilderPage,
});
