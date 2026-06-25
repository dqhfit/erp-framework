/* ==========================================================
   settings.menu-pages — "Quản lý menu": UI trực quan để gắn 1 trang
   (low-code page) vào từng node menu DQHF (legacy_menu_map). Cây menu lồng
   theo parentCode; mỗi node có thể gán / đổi / gỡ trang bằng bộ chọn tìm
   kiếm. Đây là menu CỔNG DQHF (portal) — nguồn điều hướng chính.
   Backend: legacyMenu.pageBindings + legacyMenu.setNodePage (admin settings).
   ========================================================== */
import {
  createLegacyMenuClient,
  createObjectsClient,
  type LegacyPageBinding,
} from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssignPageToMenuModal } from "@/components/AssignPageToMenuModal";
import { I } from "@/components/Icons";
import { Button, Card, Chip, EmptyState, Input, SearchableSelect } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { menuNodeLabel } from "@/lib/menu-node-label";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { machineName, useUserObjects } from "@/stores/userObjects";

const api = createLegacyMenuClient("");
const objApi = createObjectsClient("");

type FilterKind = "all" | "assigned" | "unassigned";

const STATUS_DOT: Record<string, string> = {
  xong: "bg-success",
  dang: "bg-warning",
  chua: "bg-muted/40",
};

function MenuPagesPage() {
  const pages = useUserObjects((s) => s.pages);
  const publishPage = useUserObjects((s) => s.publishPage);
  const hydrate = useUserObjects((s) => s.hydrate);
  const [rows, setRows] = useState<LegacyPageBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editCode, setEditCode] = useState<string | null>(null);
  const [orphanOpen, setOrphanOpen] = useState(false);
  const [orphanQ, setOrphanQ] = useState("");
  const [showAllPages, setShowAllPages] = useState(false);
  // Trang đang gán vào menu — mở modal chọn node đích.
  const [assignPageId, setAssignPageId] = useState<string | null>(null);
  // Chế độ sửa cấu trúc (đổi tên / chuyển nhánh / sắp xếp / thêm / ẩn / xoá node).
  const [structMode, setStructMode] = useState(false);
  const [renameCode, setRenameCode] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [moveCode, setMoveCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.pageBindings();
      setRows(data);
      // Mặc định mở cấp gốc để thấy nhánh đầu tiên.
      const codes = new Set(data.map((r) => r.sourceCode));
      const rootCodes = data
        .filter((r) => !r.parentCode || !codes.has(r.parentCode))
        .map((r) => r.sourceCode);
      setExpanded(new Set(rootCodes));
    } catch (e) {
      await dialog.alert(`Lỗi tải menu: ${(e as Error)?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byCode = useMemo(() => new Map(rows.map((r) => [r.sourceCode, r])), [rows]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, LegacyPageBinding[]>();
    for (const r of rows) {
      const k = r.parentCode && byCode.has(r.parentCode) ? r.parentCode : null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)?.push(r);
    }
    // Sửa cấu trúc: giữ thứ tự sort (để kéo lên/xuống có nghĩa). Ngoài ra:
    // sắp theo TÊN cho dễ tìm.
    for (const arr of m.values())
      arr.sort(
        structMode
          ? (a, b) => a.sort - b.sort || (a.name ?? "").localeCompare(b.name ?? "", "vi")
          : (a, b) => (a.name ?? "").localeCompare(b.name ?? "", "vi"),
      );
    return m;
  }, [rows, byCode, structMode]);

  const roots = childrenOf.get(null) ?? [];

  const hasChildren = useCallback((code: string) => childrenOf.has(code), [childrenOf]);

  // Tuỳ chọn cho bộ chọn trang: nhãn + đánh dấu nháp; sắp theo TÊN.
  const pageOptions = useMemo(
    () =>
      [...pages]
        .sort((a, b) => a.name.localeCompare(b.name, "vi"))
        .map((p) => ({
          value: p.id,
          label: p.isPublished ? p.name : `${p.name} · nháp`,
        })),
    [pages],
  );

  const assignedCount = useMemo(() => rows.filter((r) => r.pageId).length, [rows]);

  // ── Trang chưa gắn vào node menu nào (orphan) ──
  const assignedPageIds = useMemo(
    () => new Set(rows.map((r) => r.pageId).filter((x): x is string => !!x)),
    [rows],
  );
  // Map pageId → các node menu đang trỏ tới (hiện "trong: …" + gỡ khỏi menu).
  const nodesByPage = useMemo(() => {
    const m = new Map<string, LegacyPageBinding[]>();
    for (const r of rows) {
      if (!r.pageId) continue;
      if (!m.has(r.pageId)) m.set(r.pageId, []);
      m.get(r.pageId)?.push(r);
    }
    return m;
  }, [rows]);
  const orphanAll = useMemo(
    () => pages.filter((p) => !assignedPageIds.has(p.id)),
    [pages, assignedPageIds],
  );
  // Danh sách trang hiển thị trong mục: chưa gắn (mặc định) hoặc TẤT CẢ (toggle).
  const listedPages = useMemo(() => {
    const oq = orphanQ.trim().toLowerCase();
    const base = showAllPages ? pages : orphanAll;
    return [...base]
      .filter(
        (p) =>
          !oq || p.name.toLowerCase().includes(oq) || (p.techName ?? "").toLowerCase().includes(oq),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [showAllPages, pages, orphanAll, orphanQ]);

  // Trang đang gán (object) + tuỳ chọn node đích cho modal (mọi node active, kèm
  // trang hiện tại để biết sẽ THAY gì).
  const assignTargetPage = useMemo(
    () => pages.find((p) => p.id === assignPageId) ?? null,
    [pages, assignPageId],
  );
  // ── Lọc + tìm kiếm: tính tập node giữ lại (match + tổ tiên) ──
  const query = q.trim().toLowerCase();
  const forcedOpen = query !== "" || filter !== "all";

  const keepSet = useMemo(() => {
    if (!forcedOpen) return null; // null = không lọc, hiện cây đầy đủ
    const matchText = (r: LegacyPageBinding) =>
      !query ||
      [r.name, r.sourceCode, r.winId, r.pageLabel, r.pageName].some((x) =>
        (x ?? "").toLowerCase().includes(query),
      );
    const passFilter = (r: LegacyPageBinding) => {
      if (filter === "assigned") return r.pageId != null;
      if (filter === "unassigned") return !hasChildren(r.sourceCode) && r.pageId == null;
      return true;
    };
    const keep = new Set<string>();
    for (const r of rows) {
      if (matchText(r) && passFilter(r)) {
        let cur: string | null = r.sourceCode;
        while (cur && !keep.has(cur)) {
          keep.add(cur);
          cur = byCode.get(cur)?.parentCode ?? null;
        }
      }
    }
    return keep;
  }, [forcedOpen, query, filter, rows, byCode, hasChildren]);

  const toggle = (code: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  const expandAll = () => setExpanded(new Set(rows.map((r) => r.sourceCode)));
  const collapseAll = () => setExpanded(new Set());

  const assign = useCallback(
    async (code: string, pageId: string | null) => {
      setBusyCode(code);
      try {
        const res = await api.setNodePage(code, pageId);
        const pg = pageId ? pages.find((p) => p.id === pageId) : null;
        setRows((rs) =>
          rs.map((r) =>
            r.sourceCode === code
              ? {
                  ...r,
                  pageId,
                  pageLabel: pg ? pg.name : null,
                  pageName: pg ? (pg.techName ?? null) : null,
                  // Gán → trang đã xuất bản (backend tự xuất bản nháp); gỡ → null.
                  pagePublished: pageId ? true : null,
                  portStatus: pageId ? "xong" : r.portStatus,
                }
              : r,
          ),
        );
        // Trang nháp vừa được backend xuất bản riêng tư → đồng bộ store.
        if (pageId && res.autoPublished) publishPage(pageId, "private");
        // Backend xoá mềm trang tạm cũ → làm tươi store để nó biến mất khỏi danh sách.
        if (res.deletedOldPage) await hydrate();
        setEditCode(null);
        toast.success(
          pageId
            ? res.deletedOldPage
              ? "Đã thay trang (xoá trang tạm cũ)"
              : res.autoPublished
                ? "Đã gán + xuất bản riêng tư"
                : "Đã gán trang"
            : "Đã gỡ trang",
        );
      } catch (e) {
        await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusyCode(null);
      }
    },
    [pages, publishPage, hydrate],
  );

  // Gỡ 1 trang khỏi MỌI mục menu đang trỏ tới nó (đối xứng "Gán vào menu").
  const unassignPage = useCallback(
    async (pageId: string) => {
      const nodes = nodesByPage.get(pageId) ?? [];
      if (nodes.length === 0) return;
      const where = nodes.map((n) => n.name || n.sourceCode).join(", ");
      const ok = await dialog.confirm(`Gỡ trang khỏi menu “${where}”?`, {
        title: "Gỡ khỏi menu",
        danger: true,
      });
      if (!ok) return;
      for (const n of nodes) await assign(n.sourceCode, null);
    },
    [nodesByPage, assign],
  );

  // Tải lại rows GIỮ trạng thái mở/lọc (cho thao tác cấu trúc) — không nháy spinner.
  const reloadRows = useCallback(async () => {
    try {
      setRows(await api.pageBindings());
    } catch (e) {
      await dialog.alert(`Lỗi tải lại: ${(e as Error)?.message ?? e}`);
    }
  }, []);

  // Bọc 1 thao tác cấu trúc: đánh dấu busy → chạy → reload nhẹ.
  const runStruct = useCallback(
    async (code: string, fn: () => Promise<unknown>) => {
      setBusyCode(code);
      try {
        await fn();
        await reloadRows();
      } catch (e) {
        await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusyCode(null);
      }
    },
    [reloadRows],
  );

  const beginRename = (code: string, name: string) => {
    setMoveCode(null);
    setRenameCode(code);
    setRenameVal(name);
  };
  const submitRename = (code: string) => {
    const name = renameVal.trim();
    setRenameCode(null);
    if (!name) return;
    void runStruct(code, () => api.renameNode(code, name));
  };

  // Thêm TRANG con: tạo node (kind=page) + 1 trang mới (draft) gán vào node đó
  // (setNodePage tự xuất bản riêng tư). Trang để trống, mở sau ở Trình dựng.
  const addPage = async (parentCode: string | null) => {
    const name = (await dialog.prompt("Tên trang mới:", "", { title: "Thêm trang" }))?.trim();
    if (!name) return;
    setBusyCode(parentCode ?? "__root__");
    try {
      const { sourceCode } = await api.addNode(parentCode, name, "page");
      const pageId = crypto.randomUUID();
      await objApi.pages.save({
        id: pageId,
        name: machineName(name, pageId),
        label: name,
        content: {},
      });
      await api.setNodePage(sourceCode, pageId);
      await hydrate(); // store trang mới
      await reloadRows();
      if (parentCode) setExpanded((s) => new Set(s).add(parentCode));
      toast.success(`Đã tạo trang “${name}” (đã gán, xuất bản riêng tư)`);
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusyCode(null);
    }
  };

  // Thêm THƯ MỤC con: chỉ tạo node nhóm (kind=folder, KHÔNG trang) để chứa mục con.
  const addFolder = async (parentCode: string | null) => {
    const name = (await dialog.prompt("Tên thư mục mới:", "", { title: "Thêm thư mục" }))?.trim();
    if (!name) return;
    setBusyCode(parentCode ?? "__root__");
    try {
      await api.addNode(parentCode, name, "folder");
      await reloadRows();
      if (parentCode) setExpanded((s) => new Set(s).add(parentCode));
      toast.success(`Đã tạo thư mục “${name}”`);
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusyCode(null);
    }
  };

  const removeNode = async (code: string, name: string) => {
    const ok = await dialog.confirm(`Xoá mục “${name || code}”? Không thể hoàn tác.`, {
      title: "Xoá mục",
      danger: true,
    });
    if (!ok) return;
    await runStruct(code, () => api.deleteNode(code));
  };

  // Đích chuyển nhánh cho 1 node: mọi node TRỪ chính nó + hậu duệ (tránh vòng).
  const moveTargets = (code: string) => {
    const blocked = new Set<string>([code]);
    const stack = [code];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === undefined) break;
      for (const c of childrenOf.get(cur) ?? []) {
        if (!blocked.has(c.sourceCode)) {
          blocked.add(c.sourceCode);
          stack.push(c.sourceCode);
        }
      }
    }
    return rows
      .filter((r) => !blocked.has(r.sourceCode))
      .map((r) => ({ value: r.sourceCode, label: menuNodeLabel(r, byCode) }))
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));
  };

  // ── Render 1 node (đệ quy) ──
  function renderNode(r: LegacyPageBinding, depth: number) {
    if (keepSet && !keepSet.has(r.sourceCode)) return null;
    const kids = childrenOf.get(r.sourceCode) ?? [];
    const isGroup = kids.length > 0;
    // Thư mục = có con HOẶC đánh dấu kind=folder (thư mục rỗng). Không gán trang.
    const isFolder = isGroup || r.kind === "folder";
    const open = forcedOpen || expanded.has(r.sourceCode);
    const busy = busyCode === r.sourceCode;
    const editing = editCode === r.sourceCode;
    const renaming = renameCode === r.sourceCode;
    const moving = moveCode === r.sourceCode;

    return (
      <div key={r.sourceCode}>
        <div
          className={cn(
            "group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover",
            !r.active && "opacity-50",
          )}
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          {/* Chevron / spacer */}
          {isGroup ? (
            <button
              type="button"
              onClick={() => toggle(r.sourceCode)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:text-text"
              aria-label={open ? "Thu gọn" : "Mở rộng"}
            >
              {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
            </button>
          ) : (
            <span className="inline-block h-5 w-5 shrink-0" />
          )}

          {/* Icon loại node: thư mục (vàng) vs mục trang (xanh) */}
          {isFolder ? (
            <I.Folder size={15} className="shrink-0 text-warning" />
          ) : (
            <I.File size={15} className="shrink-0 text-accent-2" />
          )}

          {/* Tên + mã form (hoặc ô đổi tên khi đang sửa) */}
          {renaming ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: ô đổi tên bật theo hành động người dùng
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename(r.sourceCode);
                if (e.key === "Escape") setRenameCode(null);
              }}
              onBlur={() => submitRename(r.sourceCode)}
              className="input h-7 max-w-[20rem] flex-1 py-0 text-sm"
            />
          ) : (
            <span className="truncate text-sm text-text" title={r.name ?? r.sourceCode}>
              {r.name || r.sourceCode}
            </span>
          )}
          {r.custom && (
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
              tự thêm
            </span>
          )}
          {!r.active && (
            <span
              className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning"
              title="Đang ẩn khỏi portal — user thường không thấy mục này"
            >
              ẩn khỏi portal
            </span>
          )}
          {r.winId && (
            <code className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">
              {r.winId}
            </code>
          )}
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              STATUS_DOT[r.portStatus] ?? "bg-muted/40",
            )}
            title={`Trạng thái port: ${r.portStatus}`}
          />

          {/* Khu vực thao tác (đẩy về phải): chế độ cấu trúc HOẶC gán trang */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {structMode ? (
              moving ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-64">
                    <SearchableSelect
                      value={r.parentCode ?? ""}
                      onChange={(v) => {
                        setMoveCode(null);
                        runStruct(r.sourceCode, () => api.moveNode(r.sourceCode, v || null));
                      }}
                      options={moveTargets(r.sourceCode)}
                      wrapOptions
                      placeholder="Chọn nhánh cha…"
                      searchPlaceholder="Tìm mục cha…"
                      emptyOption="— Gốc (không cha) —"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMoveCode(null)}
                    icon={<I.X size={14} />}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={busy}
                    title="Lên"
                    aria-label="Đưa lên"
                    onClick={() =>
                      runStruct(r.sourceCode, () => api.reorderNode(r.sourceCode, "up"))
                    }
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-40"
                  >
                    <I.ChevronUp size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title="Xuống"
                    aria-label="Đưa xuống"
                    onClick={() =>
                      runStruct(r.sourceCode, () => api.reorderNode(r.sourceCode, "down"))
                    }
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-40"
                  >
                    <I.ChevronDown size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title="Đổi tên"
                    aria-label="Đổi tên"
                    onClick={() => beginRename(r.sourceCode, r.name ?? "")}
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-40"
                  >
                    <I.Edit size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title="Chuyển sang nhánh cha khác"
                    aria-label="Chuyển nhánh"
                    onClick={() => {
                      setRenameCode(null);
                      setMoveCode(r.sourceCode);
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-40"
                  >
                    <I.ArrowRight size={14} />
                  </button>
                  {/* Thêm con CHỈ cho thư mục / mục trống. Mục đã là trang là điểm
                      cuối — không cho thêm con (tránh trang biến thành thư mục). */}
                  {(isFolder || !r.pageId) && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        title="Thêm thư mục con"
                        aria-label="Thêm thư mục con"
                        onClick={() => addFolder(r.sourceCode)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-warning/15 hover:text-warning disabled:opacity-40"
                      >
                        <I.FolderPlus size={15} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        title="Thêm trang con"
                        aria-label="Thêm trang con"
                        onClick={() => addPage(r.sourceCode)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-accent-2/15 hover:text-accent-2 disabled:opacity-40"
                      >
                        <I.FilePlus size={15} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    title={r.active ? "Ẩn khỏi menu" : "Hiện lại"}
                    aria-label={r.active ? "Ẩn" : "Hiện"}
                    onClick={() =>
                      runStruct(r.sourceCode, () => api.setNodeActive(r.sourceCode, !r.active))
                    }
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-text disabled:opacity-40"
                  >
                    {r.active ? <I.EyeOff size={14} /> : <I.Eye size={14} />}
                  </button>
                  {r.custom ? (
                    <button
                      type="button"
                      disabled={busy}
                      title="Xoá mục"
                      aria-label="Xoá mục"
                      onClick={() => removeNode(r.sourceCode, r.name ?? "")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-danger/15 hover:text-danger disabled:opacity-40"
                    >
                      <I.Trash size={14} />
                    </button>
                  ) : (
                    <span
                      title="Mục từ DQHF — không xoá được. Dùng nút Ẩn để loại khỏi portal."
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted/30 cursor-default"
                    >
                      <I.Lock size={13} />
                    </span>
                  )}
                </div>
              )
            ) : isFolder ? (
              // THƯ MỤC: không gán trang lên chính nó. Trang đặt làm mục con (+).
              r.pageId ? (
                // Thư mục lỡ gắn trang (dữ liệu cũ/sai) → cảnh báo + cho gỡ để dọn.
                <>
                  <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning">
                    thư mục đang gắn trang — nên gỡ
                  </span>
                  <Chip className="max-w-[14rem] truncate" title={r.pageLabel ?? ""}>
                    {r.pageLabel || r.pageName || r.pageId}
                  </Chip>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => assign(r.sourceCode, null)}
                    icon={<I.Trash size={14} />}
                    title="Gỡ trang khỏi thư mục"
                  />
                </>
              ) : (
                <span className="text-[11px] text-muted">
                  thư mục ·{" "}
                  {kids.length ? `${kids.length} mục con` : "trống — dùng + để thêm trang"}
                </span>
              )
            ) : editing ? (
              <div className="flex items-center gap-1.5">
                <div className="w-72">
                  <SearchableSelect
                    value={r.pageId ?? ""}
                    onChange={(v) => assign(r.sourceCode, v || null)}
                    options={pageOptions}
                    placeholder="Tìm + chọn trang…"
                    searchPlaceholder="Gõ tên trang…"
                    emptyOption="— Không gán —"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditCode(null)}
                  icon={<I.X size={14} />}
                />
              </div>
            ) : r.pageId ? (
              <>
                <Chip className="max-w-[18rem] truncate" title={r.pageLabel ?? ""}>
                  {r.pageLabel || r.pageName || r.pageId}
                </Chip>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px]",
                    r.pagePublished ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                  )}
                >
                  {r.pagePublished ? "Đã xuất bản" : "Nháp"}
                </span>
                <a
                  href={`/pages/${r.pageId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-text"
                  title="Mở trang (tab mới)"
                  aria-label="Mở trang"
                >
                  <I.Eye size={14} />
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEditCode(r.sourceCode)}
                >
                  Đổi
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => assign(r.sourceCode, null)}
                  icon={<I.Trash size={14} />}
                  title="Gỡ trang"
                />
              </>
            ) : (
              <>
                {r.active && (
                  <span
                    className="shrink-0 rounded bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger/70"
                    title="Mục này đang hiện trong portal nhưng chưa có trang — user bấm vào sẽ không thấy gì"
                  >
                    chưa có trang
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEditCode(r.sourceCode)}
                  icon={<I.Plus size={14} />}
                >
                  Gán trang
                </Button>
              </>
            )}
          </div>
        </div>

        {isGroup && open && kids.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  const FILTERS: { key: FilterKind; label: string }[] = [
    { key: "all", label: "Tất cả" },
    { key: "assigned", label: `Đã gán (${assignedCount})` },
    { key: "unassigned", label: "Chưa gán" },
  ];

  return (
    // h-full + overflow-y-auto: <main> app shell là overflow-hidden nên route phải
    // tự cấp khung cuộn (giống settings.rbac/llm), nếu không cây menu dài bị cắt.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold text-text">
            <I.GitBranch size={18} className="text-accent" />
            Quản lý menu
          </h1>
          <p className="text-sm text-muted">
            Gắn từng mục menu DQHF (cổng người dùng) với một trang low-code. Node đã gán trang đã
            xuất bản sẽ hiện trên menu cổng cho mọi người; trang nháp chỉ admin/editor thấy.
          </p>
        </header>

        {/* Thanh công cụ */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[16rem]">
            <I.Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm theo tên mục, mã form, hoặc tên trang…"
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-panel p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  filter === f.key ? "bg-accent/15 text-accent" : "text-muted hover:text-text",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={expandAll} icon={<I.ChevronDown size={14} />}>
            Mở hết
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={collapseAll}
            icon={<I.ChevronRight size={14} />}
          >
            Thu hết
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            icon={<I.RefreshCw size={14} />}
            title="Tải lại"
          />
          <Button
            variant={structMode ? "primary" : "ghost"}
            size="sm"
            onClick={() => {
              setStructMode((m) => !m);
              setEditCode(null);
              setRenameCode(null);
              setMoveCode(null);
            }}
            icon={<I.Edit size={14} />}
            title="Bật/tắt chế độ sửa cấu trúc menu"
          >
            Sửa cấu trúc
          </Button>
          {structMode && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={() => addFolder(null)}
                icon={<I.FolderPlus size={14} />}
              >
                Thêm thư mục gốc
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => addPage(null)}
                icon={<I.FilePlus size={14} />}
              >
                Thêm trang gốc
              </Button>
            </>
          )}
        </div>

        {structMode && (
          <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-muted">
            Chế độ sửa cấu trúc: đổi tên, sắp xếp, chuyển nhánh, ẩn/hiện, xoá.{" "}
            <I.FolderPlus size={12} className="inline text-warning" /> = thêm{" "}
            <span className="text-warning">thư mục con</span> (chứa mục, không gắn trang);{" "}
            <I.FilePlus size={12} className="inline text-accent-2" /> = thêm{" "}
            <span className="text-accent-2">trang con</span> (tạo trang mới + gắn). Chỉnh tay được
            giữ qua mỗi lần re-import DQHF.
          </p>
        )}

        {/* Danh sách trang — thu gọn/mở rộng + tìm kiếm + nút "Gán vào menu" mỗi trang */}
        <Card className="overflow-hidden p-0">
          <button
            type="button"
            onClick={() => setOrphanOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-hover"
          >
            {orphanOpen ? <I.ChevronDown size={15} /> : <I.ChevronRight size={15} />}
            <I.File size={15} className="text-accent-2" />
            <span className="text-sm font-medium text-text">
              {showAllPages ? "Tất cả trang" : "Trang chưa gắn menu"}
            </span>
            <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-muted">
              {showAllPages ? pages.length : orphanAll.length}
            </span>
            <span className="ml-auto text-xs text-muted">{orphanOpen ? "Thu gọn" : "Mở rộng"}</span>
          </button>
          {orphanOpen && (
            <div className="space-y-2 border-t border-border p-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <I.Search
                    size={15}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <Input
                    value={orphanQ}
                    onChange={(e) => setOrphanQ(e.target.value)}
                    placeholder={showAllPages ? "Tìm trang…" : "Tìm trang chưa gắn…"}
                    className="pl-8"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-panel p-0.5">
                  <button
                    type="button"
                    onClick={() => setShowAllPages(false)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors",
                      !showAllPages ? "bg-accent/15 text-accent" : "text-muted hover:text-text",
                    )}
                  >
                    Chưa gắn
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAllPages(true)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors",
                      showAllPages ? "bg-accent/15 text-accent" : "text-muted hover:text-text",
                    )}
                  >
                    Tất cả
                  </button>
                </div>
              </div>
              {!showAllPages && orphanAll.length === 0 ? (
                <p className="px-1 py-3 text-center text-sm text-muted">
                  Mọi trang đều đã được gắn vào menu. 🎉
                </p>
              ) : listedPages.length === 0 ? (
                <p className="px-1 py-3 text-center text-sm text-muted">
                  Không có trang nào khớp “{orphanQ}”.
                </p>
              ) : (
                <div className="max-h-[22rem] space-y-0.5 overflow-y-auto pr-1">
                  {listedPages.map((p) => (
                    <div
                      key={p.id}
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
                    >
                      <I.File size={14} className="shrink-0 text-accent-2" />
                      <span className="truncate text-sm text-text" title={p.name}>
                        {p.name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 py-0.5 text-[10px]",
                          p.isPublished
                            ? "bg-success/15 text-success"
                            : "bg-warning/15 text-warning",
                        )}
                      >
                        {p.isPublished ? "xb" : "nháp"}
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        {assignedPageIds.has(p.id) && (
                          <span
                            className="max-w-[10rem] shrink-0 truncate rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted"
                            title={(nodesByPage.get(p.id) ?? [])
                              .map((n) => n.name || n.sourceCode)
                              .join(", ")}
                          >
                            trong:{" "}
                            {(nodesByPage.get(p.id) ?? [])
                              .map((n) => n.name || n.sourceCode)
                              .join(", ")}
                          </span>
                        )}
                        <a
                          href={`/pages/${p.id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Mở trang (tab mới)"
                          aria-label="Mở trang"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-text"
                        >
                          <I.Eye size={14} />
                        </a>
                        {assignedPageIds.has(p.id) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => unassignPage(p.id)}
                            icon={<I.Trash size={14} />}
                            title="Gỡ trang khỏi mục menu"
                          >
                            Gỡ khỏi menu
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAssignPageId(p.id)}
                            icon={<I.GitBranch size={14} />}
                          >
                            Gán vào menu
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="px-1 text-xs text-muted">
                “Gán vào menu” → chọn mục menu đích; trang hiện tại của mục đó (nếu có) sẽ được thay
                bằng trang này. Hoặc gán trực tiếp ở cây menu bên dưới.
              </p>
            </div>
          )}
        </Card>

        <Card className="p-1.5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
              <I.Loader size={16} className="animate-spin" />
              Đang tải cây menu…
            </div>
          ) : roots.length === 0 ? (
            <EmptyState
              icon={<I.GitBranch size={28} />}
              title="Chưa có menu DQHF"
              hint="Vào Migrate DQHF → Cockpit để import cây menu (SYS_MENU_NEW) trước."
            />
          ) : keepSet && keepSet.size === 0 ? (
            <EmptyState
              icon={<I.Search size={28} />}
              title="Không khớp"
              hint="Không có mục menu nào khớp bộ lọc / từ khóa hiện tại."
            />
          ) : (
            <div className="space-y-0.5">{roots.map((r) => renderNode(r, 0))}</div>
          )}
        </Card>
      </div>

      {/* Gán 1 trang vào 1 mục menu — DUYỆT CÂY (chọn đúng vị trí), hỗ trợ thêm
          mục con + gắn trang built-in. Đồng bộ với nút "Gán vào menu" ở Sidebar. */}
      <AssignPageToMenuModal
        page={assignTargetPage}
        onClose={() => setAssignPageId(null)}
        onDone={() => {
          void load();
        }}
      />
    </div>
  );
}

export const Route = createFileRoute("/settings/menu-pages")({
  component: MenuPagesPage,
});
