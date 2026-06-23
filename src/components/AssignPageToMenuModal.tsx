/* ==========================================================
   AssignPageToMenuModal — gán 1 trang vào 1 mục menu DQHF (legacy_menu_map).
   DUYỆT CÂY MENU: thay vì ô tìm phẳng (không thấy mục nằm ở đâu trong cây),
   hiện cây menu thu/mở được → chọn ĐÚNG vị trí, thấy trang đang gán ở mỗi
   mục. Có ô lọc nhanh theo tên (tự mở nhánh khớp). Đặt page_id của mục đích
   thành trang này (thay trang hiện tại nếu có).
   Backend: legacyMenu.pageBindings + setNodePage (rbac edit settings).
   ========================================================== */
import { createLegacyMenuClient, type LegacyPageBinding } from "@erp-framework/client";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Modal } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

const api = createLegacyMenuClient("");

interface Props {
  /** Trang cần gán (null = đóng modal). */
  page: { id: string; name: string } | null;
  onClose: () => void;
  /** Gọi sau khi gán thành công (vd để refetch cây menu). */
  onDone?: () => void;
}

export function AssignPageToMenuModal({ page, onClose, onDone }: Props) {
  const publishPage = useUserObjects((s) => s.publishPage);
  const hydrate = useUserObjects((s) => s.hydrate);
  const [nodes, setNodes] = useState<LegacyPageBinding[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // sourceCode đang gán
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!page) return;
    setQ("");
    setExpanded({});
    let alive = true;
    api
      .pageBindings()
      .then((r) => {
        if (alive) setNodes(r);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [page]);

  // childrenOf: parentCode → con (sort theo `sort`). Chỉ giữ node active.
  const { childrenOf, roots } = useMemo(() => {
    const active = nodes.filter((n) => n.active);
    const codes = new Set(active.map((n) => n.sourceCode));
    const m = new Map<string, LegacyPageBinding[]>();
    for (const n of active) {
      // Gốc = không cha HOẶC cha bị lọc ra (mồ côi vẫn coi là gốc, khỏi rớt nhánh).
      const k = !n.parentCode || !codes.has(n.parentCode) ? "__root" : n.parentCode;
      const arr = m.get(k);
      if (arr) arr.push(n);
      else m.set(k, [n]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort - b.sort);
    return { childrenOf: m, roots: m.get("__root") ?? [] };
  }, [nodes]);

  // Lọc nhanh: tập sourceCode hiện ra (node khớp HOẶC có con khớp). null = hiện hết.
  const visible = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return null as Set<string> | null;
    const set = new Set<string>();
    const match = (n: LegacyPageBinding) =>
      (n.name ?? n.sourceCode).toLowerCase().includes(ql) ||
      (n.pageName ?? "").toLowerCase().includes(ql);
    const visit = (n: LegacyPageBinding): boolean => {
      let anyChild = false;
      for (const c of childrenOf.get(n.sourceCode) ?? []) if (visit(c)) anyChild = true;
      if (match(n) || anyChild) {
        set.add(n.sourceCode);
        return true;
      }
      return false;
    };
    for (const r of roots) visit(r);
    return set;
  }, [q, childrenOf, roots]);

  const pick = async (node: LegacyPageBinding) => {
    if (!page || busy) return;
    // Đích đang gán của node: trang DB (pageId) hoặc route built-in (staticRoute).
    const assigned = node.pageId ?? node.staticRoute;
    if (assigned === page.id) {
      toast.info("Trang đã gán ở mục này rồi");
      return;
    }
    if (assigned) {
      const ok = await dialog.confirm(
        `Mục “${node.name ?? node.sourceCode}” đang gắn “${
          node.pageLabel || node.pageName || node.staticRoute || "?"
        }”. Thay bằng “${page.name}”?`,
        { title: "Thay trang", danger: true },
      );
      if (!ok) return;
    }
    setBusy(node.sourceCode);
    try {
      const res = await api.setNodePage(node.sourceCode, page.id);
      // Trang DB nháp vừa được backend xuất bản riêng tư → đồng bộ store.
      // (Route built-in id="/..." không có trong store nên bỏ qua.)
      if (res.autoPublished && !page.id.startsWith("/")) publishPage(page.id, "private");
      // Backend đã xoá mềm trang tạm cũ → làm tươi store để nó biến mất khỏi danh sách.
      if (res.deletedOldPage) await hydrate();
      toast.success(
        res.deletedOldPage
          ? "Đã thay trang (xoá trang tạm cũ)"
          : res.autoPublished
            ? "Đã gán + xuất bản riêng tư"
            : "Đã gán trang vào menu",
      );
      onDone?.();
      onClose();
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  // Tạo MỤC CON mới dưới `parent` (đặt tên = tên trang) rồi gắn trang vào con.
  // Cho phép gom nhiều trang dưới 1 menu mà không đụng trang của mục cha.
  const addAsChild = async (parent: LegacyPageBinding) => {
    if (!page || busy) return;
    setBusy(parent.sourceCode);
    try {
      const { sourceCode } = await api.addNode(parent.sourceCode, page.name);
      const res = await api.setNodePage(sourceCode, page.id);
      if (res.autoPublished && !page.id.startsWith("/")) publishPage(page.id, "private");
      toast.success(`Đã thêm “${page.name}” làm mục con của “${parent.name ?? parent.sourceCode}”`);
      onDone?.();
      onClose();
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const toggle = (code: string, open: boolean) =>
    setExpanded((prev) => ({ ...prev, [code]: !open }));

  return (
    <Modal
      open={page !== null}
      onClose={onClose}
      title="Gắn trang vào menu"
      width={560}
      align="top"
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Chọn mục menu để gắn trang{" "}
          <span className="font-medium text-text">“{page?.name ?? ""}”</span>. Duyệt cây để thấy mục
          nằm ở đâu; mục đã có trang sẽ bị thay.
        </p>
        <div className="relative">
          <I.Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Lọc nhanh theo tên mục…"
            className="input !pl-8"
            // biome-ignore lint/a11y/noAutofocus: ô lọc là hành động chính của modal
            autoFocus
          />
        </div>
        <div className="max-h-[55vh] overflow-auto rounded-md border border-border bg-bg-soft">
          {roots.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted">
              {nodes.length ? "Đang tải mục menu…" : "Chưa có mục menu nào"}
            </div>
          ) : visible && visible.size === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted">Không có mục nào khớp</div>
          ) : (
            <ul className="py-1">
              {roots.map((r) => (
                <AssignBranch
                  key={r.sourceCode}
                  node={r}
                  childrenOf={childrenOf}
                  depth={0}
                  currentPageId={page?.id ?? null}
                  visible={visible}
                  expanded={expanded}
                  filtering={!!visible}
                  busy={busy}
                  onToggle={toggle}
                  onPick={pick}
                  onAddChild={addAsChild}
                />
              ))}
            </ul>
          )}
        </div>
        {/* Chú thích icon để phân biệt thư mục vs mục trang. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <I.Folder size={12} className="text-warning" /> = thư mục (chứa mục con)
          </span>
          <span className="inline-flex items-center gap-1">
            <I.Layout size={12} className="text-accent-2" /> = mục đã gắn trang
          </span>
          <span className="inline-flex items-center gap-1">
            <I.File size={12} className="text-muted/50" /> = mục trống
          </span>
        </div>
        <p className="text-xs text-muted">
          Bấm <span className="text-text">tên mục thường</span> = gắn vào mục đó. Với{" "}
          <span className="text-warning">thư mục</span> không gắn trang lên chính nó — bấm{" "}
          <span className="text-accent">+</span> để thêm trang vào{" "}
          <span className="text-text">bên trong</span> (làm mục con).
        </p>
        <p className="text-xs text-muted">
          Gắn nhầm? Mở <span className="text-text">Cài đặt → Menu</span> (hoặc cây “Menu” ở thanh
          bên) → mỗi mục có nút <span className="text-text">Đổi trang</span> /{" "}
          <span className="text-danger">Gỡ khỏi menu</span>.
        </p>
      </div>
    </Modal>
  );
}

function AssignBranch({
  node,
  childrenOf,
  depth,
  currentPageId,
  visible,
  expanded,
  filtering,
  busy,
  onToggle,
  onPick,
  onAddChild,
}: {
  node: LegacyPageBinding;
  childrenOf: Map<string, LegacyPageBinding[]>;
  depth: number;
  currentPageId: string | null;
  visible: Set<string> | null;
  expanded: Record<string, boolean>;
  filtering: boolean;
  busy: string | null;
  onToggle: (code: string, open: boolean) => void;
  onPick: (node: LegacyPageBinding) => void;
  onAddChild: (node: LegacyPageBinding) => void;
}) {
  if (visible && !visible.has(node.sourceCode)) return null;
  const kids = (childrenOf.get(node.sourceCode) ?? []).filter(
    (k) => !visible || visible.has(k.sourceCode),
  );
  const hasKids = kids.length > 0;
  const childCount = childrenOf.get(node.sourceCode)?.length ?? 0;
  // Khi lọc → mở hết nhánh khớp. Bình thường: gốc mở sẵn, còn lại theo state.
  const open = filtering || (expanded[node.sourceCode] ?? depth === 0);
  // Đích đang gán: trang DB (pageId) hoặc route built-in (staticRoute).
  const assigned = node.pageId ?? node.staticRoute;
  const assignedLabel = node.pageLabel || node.pageName || node.staticRoute || "?";
  const isHere = assigned != null && assigned === currentPageId;
  const isBusy = busy === node.sourceCode;
  // Phân loại mục: THƯ MỤC (có con HOẶC kind=folder) — KHÔNG gán trang lên chính
  // nó, chỉ thêm mục con (+); mục đã gắn trang = trang; còn lại = ô trang trống.
  const isFolder = hasKids || node.kind === "folder";

  return (
    <li>
      <div
        className={cn(
          "group flex items-center transition-colors",
          isHere ? "bg-accent/10" : "hover:bg-hover/50",
        )}
      >
        {/* Chevron mở/thu gọn (chỉ khi có con) — bấm KHÔNG gán, chỉ xòe nhánh. */}
        <button
          type="button"
          onClick={() => hasKids && onToggle(node.sourceCode, open)}
          style={{ paddingLeft: 6 + depth * 14 }}
          className={cn(
            "shrink-0 py-1.5 pr-0.5",
            hasKids ? "text-muted hover:text-text cursor-pointer" : "cursor-default",
          )}
          tabIndex={hasKids ? 0 : -1}
          aria-label={hasKids ? (open ? "Thu gọn" : "Mở rộng") : undefined}
        >
          {hasKids ? (
            <I.ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} />
          ) : (
            <span className="inline-block w-[13px]" />
          )}
        </button>
        {/* Nhãn mục — bấm: mục thường = GÁN trang; thư mục = xòe nhánh (không gán
            lên thư mục, dùng + để thêm trang con). */}
        <button
          type="button"
          onClick={() => {
            if (isFolder) {
              if (hasKids) onToggle(node.sourceCode, open);
              return;
            }
            onPick(node);
          }}
          disabled={!!busy}
          title={
            isFolder
              ? "Thư mục — bấm + để thêm trang vào trong"
              : `Gắn trang vào “${node.name ?? node.sourceCode}”`
          }
          className="flex-1 min-w-0 text-left py-1.5 pr-2 flex items-center gap-2 disabled:opacity-60"
        >
          {/* Icon phân loại: thư mục / trang (đã gắn) / ô trống. */}
          {isFolder ? (
            open && hasKids ? (
              <I.FolderOpen size={14} className="shrink-0 text-warning" />
            ) : (
              <I.Folder size={14} className="shrink-0 text-warning" />
            )
          ) : assigned ? (
            <I.Layout size={13} className="shrink-0 text-accent-2" />
          ) : (
            <I.File size={13} className="shrink-0 text-muted/50" />
          )}
          <span
            className={cn(
              "whitespace-nowrap lowercase first-letter:uppercase",
              isFolder ? "text-sm font-medium text-text" : "text-sm text-text",
            )}
          >
            {node.name ?? node.sourceCode}
          </span>
          {/* Thư mục → nhãn cho biết là menu chứa mục con (không gán trang). */}
          {isFolder && (
            <span className="shrink-0 text-[11px] text-warning/80">
              {hasKids ? `thư mục · ${childCount} mục` : "thư mục trống"}
            </span>
          )}
          {assigned &&
            (isHere ? (
              <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-accent">
                <I.Check size={11} /> đang ở đây
              </span>
            ) : (
              <span className="shrink-0 text-[11px] text-muted">
                · đang gắn: <span className="text-accent">{assignedLabel}</span>
              </span>
            ))}
          {isBusy && <I.Loader size={12} className="shrink-0 animate-spin text-muted" />}
        </button>
        {/* "+" thêm trang con — CHỈ cho thư mục / mục trống. KHÔNG cho mục đã là
            trang (trang là điểm cuối, không chứa con; muốn đổi thì bấm tên = thay). */}
        {(isFolder || !assigned) && (
          <button
            type="button"
            onClick={() => onAddChild(node)}
            disabled={!!busy}
            title={`Thêm trang làm mục con của “${node.name ?? node.sourceCode}”`}
            className="shrink-0 mr-1 w-5 h-5 rounded flex items-center justify-center text-muted hover:bg-accent/15 hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
          >
            <I.Plus size={13} />
          </button>
        )}
      </div>
      {hasKids && open && (
        <ul>
          {kids.map((k) => (
            <AssignBranch
              key={k.sourceCode}
              node={k}
              childrenOf={childrenOf}
              depth={depth + 1}
              currentPageId={currentPageId}
              visible={visible}
              expanded={expanded}
              filtering={filtering}
              busy={busy}
              onToggle={onToggle}
              onPick={onPick}
              onAddChild={onAddChild}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
