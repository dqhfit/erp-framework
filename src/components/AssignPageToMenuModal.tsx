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
import { toast } from "@/lib/toast";

const api = createLegacyMenuClient("");

interface Props {
  /** Trang cần gán (null = đóng modal). */
  page: { id: string; name: string } | null;
  onClose: () => void;
  /** Gọi sau khi gán thành công (vd để refetch cây menu). */
  onDone?: () => void;
}

export function AssignPageToMenuModal({ page, onClose, onDone }: Props) {
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

  const options = useMemo(
    () =>
      nodes
        .filter((n) => n.active)
        .map((n) => ({
          value: n.sourceCode,
          label: n.pageId
            ? `${n.name || n.sourceCode}  ·  hiện: ${n.pageLabel || n.pageName || "?"}`
            : (n.name ?? n.sourceCode),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "vi")),
    [nodes],
  );

  const pick = async (sourceCode: string) => {
    if (!page || !sourceCode || busy) return;
    setBusy(true);
    try {
      await api.setNodePage(sourceCode, page.id);
      toast.success("Đã gán trang vào menu");
      onDone?.();
      onClose();
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={page !== null} onClose={onClose} title="Gán trang vào menu" width={520}>
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
