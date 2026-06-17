/* ==========================================================
   ChangeMenuNodePageModal — đổi TRANG liên kết của 1 mục menu DQHF
   (legacy_menu_map) ngay từ cây "Menu" ở sidebar. Đối xứng với
   AssignPageToMenuModal (kia: trang cố định → chọn mục; đây: mục cố
   định → chọn trang). Đặt page_id của mục thành trang đã chọn (thay
   trang đang gán nếu có).
   Backend: legacyMenu.setNodePage (rbac edit settings).
   ========================================================== */
import { createLegacyMenuClient } from "@erp-framework/client";
import { useMemo, useState } from "react";
import { Modal, SearchableSelect } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { toast } from "@/lib/toast";
import { useUserObjects } from "@/stores/userObjects";

const api = createLegacyMenuClient("");

interface Props {
  /** Mục menu cần đổi trang (null = đóng modal). pageId = trang đang gán (nếu có). */
  node: { code: string; name: string; pageId: string | null } | null;
  onClose: () => void;
  /** Gọi sau khi đổi thành công (vd để refetch cây menu). */
  onDone?: () => void;
}

export function ChangeMenuNodePageModal({ node, onClose, onDone }: Props) {
  const pages = useUserObjects((s) => s.pages);
  const publishPage = useUserObjects((s) => s.publishPage);
  const [busy, setBusy] = useState(false);

  // Mọi trang (mới nhất đầu store), sắp xếp theo tên; trang đang gán có hậu tố.
  const options = useMemo(
    () =>
      [...pages]
        .sort((a, b) => a.name.localeCompare(b.name, "vi"))
        .map((p) => ({
          value: p.id,
          label: p.id === node?.pageId ? `${p.name} · đang gán` : p.name,
        })),
    [pages, node?.pageId],
  );

  const pick = async (pageId: string) => {
    if (!node || !pageId || busy || pageId === node.pageId) return;
    setBusy(true);
    try {
      const res = await api.setNodePage(node.code, pageId);
      // Trang nháp vừa được backend xuất bản riêng tư → đồng bộ store.
      if (res.autoPublished) publishPage(pageId, "private");
      toast.success(
        res.autoPublished ? "Đã đổi trang + xuất bản riêng tư" : "Đã đổi trang liên kết",
      );
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
      open={node !== null}
      onClose={onClose}
      title="Đổi trang liên kết"
      width={520}
      align="top"
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Chọn trang để gán cho mục menu{" "}
          <span className="font-medium text-text">“{node?.name ?? ""}”</span>. Trang đang gán sẽ bị
          thay.
        </p>
        <SearchableSelect
          value={node?.pageId ?? ""}
          onChange={pick}
          options={options}
          wrapOptions
          placeholder={pages.length ? "Tìm + chọn trang…" : "Chưa có trang nào"}
          searchPlaceholder="Gõ tên trang…"
        />
      </div>
    </Modal>
  );
}
