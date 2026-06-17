/* ==========================================================
   NewPageModal — popup tạo trang mới: nhập tên + (tuỳ chọn) GÁN VÀO MENU ngay.
   Menu: chọn mục có sẵn, HOẶC tạo mục menu mới tại chỗ (đặt dưới gốc/cha tuỳ),
   hoặc không gán. Tạo xong điều hướng sang Trình dựng trang để thiết kế.
   Backend: pages.save + legacyMenu.addNode/setNodePage (gán → tự xuất bản riêng tư).
   ========================================================== */
import {
  createLegacyMenuClient,
  createObjectsClient,
  type LegacyPageBinding,
} from "@erp-framework/client";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input, Modal, SearchableSelect } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { buildNodeIndex, menuNodeLabel } from "@/lib/menu-node-label";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { machineName, useUserObjects } from "@/stores/userObjects";

const objApi = createObjectsClient("");
const menuApi = createLegacyMenuClient("");

type MenuMode = "none" | "existing" | "new";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Có quyền sửa Cài đặt (gán menu cần rbac edit settings). false → ẩn phần menu. */
  canAssignMenu: boolean;
}

export function NewPageModal({ open, onClose, canAssignMenu }: Props) {
  const navigate = useNavigate();
  const hydrate = useUserObjects((s) => s.hydrate);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<MenuMode>("none");
  const [nodeCode, setNodeCode] = useState(""); // mục có sẵn
  const [newMenuName, setNewMenuName] = useState(""); // tên mục mới
  const [newParent, setNewParent] = useState(""); // cha của mục mới ("" = gốc)
  const [nodes, setNodes] = useState<LegacyPageBinding[]>([]);
  const [busy, setBusy] = useState(false);

  // Mở: reset + nạp danh sách mục menu.
  useEffect(() => {
    if (!open) return;
    setName("");
    setMode("none");
    setNodeCode("");
    setNewMenuName("");
    setNewParent("");
    if (canAssignMenu)
      menuApi
        .pageBindings()
        .then(setNodes)
        .catch(() => setNodes([]));
  }, [open, canAssignMenu]);

  const byCode = useMemo(() => buildNodeIndex(nodes), [nodes]);
  const nodeOptions = useMemo(
    () =>
      nodes
        .filter((n) => n.active)
        .map((n) => ({
          value: n.sourceCode,
          label: menuNodeLabel(n, byCode, { showAssigned: true }),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "vi")),
    [nodes, byCode],
  );
  const parentOptions = useMemo(
    () =>
      nodes
        .filter((n) => n.active)
        .map((n) => ({ value: n.sourceCode, label: menuNodeLabel(n, byCode) }))
        .sort((a, b) => a.label.localeCompare(b.label, "vi")),
    [nodes, byCode],
  );

  const submit = async () => {
    const nm = name.trim();
    if (!nm) {
      await dialog.alert("Nhập tên trang.");
      return;
    }
    if (mode === "existing" && !nodeCode) {
      await dialog.alert("Chọn mục menu, hoặc đổi sang “Không gán”.");
      return;
    }
    if (mode === "new" && !newMenuName.trim()) {
      await dialog.alert("Nhập tên mục menu mới.");
      return;
    }
    setBusy(true);
    try {
      // 1. Tạo trang mới (draft).
      const pageId = crypto.randomUUID();
      await objApi.pages.save({
        id: pageId,
        name: machineName(nm, pageId),
        label: nm,
        content: {},
      });
      // 2. Mục đích gán (có sẵn / tạo mới / không).
      let targetNode: string | null = null;
      if (mode === "existing") targetNode = nodeCode;
      else if (mode === "new") {
        const { sourceCode } = await menuApi.addNode(newParent || null, newMenuName.trim());
        targetNode = sourceCode;
      }
      // 3. Gán (tự xuất bản riêng tư).
      if (targetNode) await menuApi.setNodePage(targetNode, pageId);
      await hydrate();
      toast.success(targetNode ? "Đã tạo trang + gán vào menu" : "Đã tạo trang");
      onClose();
      navigate({ to: "/pages/$id", params: { id: pageId } });
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const MODES: { key: MenuMode; label: string }[] = [
    { key: "none", label: "Không gán" },
    { key: "existing", label: "Mục có sẵn" },
    { key: "new", label: "Tạo mục mới" },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tạo trang mới"
      width={520}
      align="top"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy} icon={<I.Plus size={14} />}>
            Tạo trang
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Tên trang</div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vd: Danh sách khách hàng"
            // biome-ignore lint/a11y/noAutofocus: ô tên là field chính của popup, focus ngay cho tiện gõ
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && mode === "none") submit();
            }}
          />
        </div>

        {canAssignMenu && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted">Gán vào menu</div>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    mode === m.key
                      ? "border-accent/60 bg-accent/15 text-accent"
                      : "border-border text-muted hover:text-text",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {mode === "existing" && (
              <SearchableSelect
                value={nodeCode}
                onChange={setNodeCode}
                options={nodeOptions}
                wrapOptions
                placeholder={nodes.length ? "Tìm + chọn mục menu…" : "Đang tải mục menu…"}
                searchPlaceholder="Gõ tên mục menu…"
              />
            )}

            {mode === "new" && (
              <div className="space-y-2">
                <Input
                  value={newMenuName}
                  onChange={(e) => setNewMenuName(e.target.value)}
                  placeholder="Tên mục menu mới"
                />
                <SearchableSelect
                  value={newParent}
                  onChange={setNewParent}
                  options={parentOptions}
                  wrapOptions
                  placeholder="Đặt dưới mục… (để trống = gốc)"
                  searchPlaceholder="Tìm mục cha…"
                  emptyOption="— Gốc (không cha) —"
                />
              </div>
            )}
            <p className="text-xs text-muted">
              Gán vào menu sẽ tự xuất bản trang ở chế độ riêng tư (hiện trên menu cho người dùng đã
              đăng nhập).
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
