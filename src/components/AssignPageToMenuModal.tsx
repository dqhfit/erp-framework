/* ==========================================================
   AssignPageToMenuModal — gán 1 trang vào 1 mục menu DQHF (legacy_menu_map):
   chọn mục đích, đặt page_id của mục đó thành trang này (thay trang hiện tại
   nếu có). Dùng ở Sidebar (nhóm "Chưa gắn menu") + có thể tái dùng nơi khác.
   Backend: legacyMenu.pageBindings + setNodePage (rbac edit settings).
   ========================================================== */
import { createLegacyMenuClient, type LegacyPageBinding } from "@erp-framework/client";
import { useEffect, useMemo, useState } from "react";
import { Modal, SearchableSelect } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { buildNodeIndex, menuNodeLabel } from "@/lib/menu-node-label";
import { toast } from "@/lib/toast";
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
  const [nodes, setNodes] = useState<LegacyPageBinding[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!page) return;
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

  const options = useMemo(() => {
    const byCode = buildNodeIndex(nodes);
    return nodes
      .filter((n) => n.active)
      .map((n) => ({
        value: n.sourceCode,
        label: menuNodeLabel(n, byCode, { showAssigned: true }),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));
  }, [nodes]);

  const pick = async (sourceCode: string) => {
    if (!page || !sourceCode || busy) return;
    setBusy(true);
    try {
      const res = await api.setNodePage(sourceCode, page.id);
      // Trang nháp vừa được backend xuất bản riêng tư → đồng bộ store.
      if (res.autoPublished) publishPage(page.id, "private");
      toast.success(res.autoPublished ? "Đã gán + xuất bản riêng tư" : "Đã gán trang vào menu");
      onDone?.();
      onClose();
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={page !== null}
      onClose={onClose}
      title="Gán trang vào menu"
      width={520}
      align="top"
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Chọn mục menu để gán trang{" "}
          <span className="font-medium text-text">“{page?.name ?? ""}”</span>. Nếu mục đã có trang,
          trang đó sẽ bị thay.
        </p>
        <SearchableSelect
          value=""
          onChange={pick}
          options={options}
          wrapOptions
          placeholder={nodes.length ? "Tìm + chọn mục menu…" : "Đang tải mục menu…"}
          searchPlaceholder="Gõ tên mục menu…"
        />
        <p className="text-xs text-muted">
          Mục có “· hiện: …” là mục đã có trang — chọn sẽ thay trang đó.
        </p>
      </div>
    </Modal>
  );
}
