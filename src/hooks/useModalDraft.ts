/* Hook lưu/khôi phục nháp form Modal vào IndexedDB.
   Cách dùng:
     const { values, patch, clearDraft } = useModalDraft('create-entity', { name: '', type: '' })
     // - `values`     : state hiện tại của form (merge từ IDB khi load)
     // - `patch`      : cập nhật từng field, tự debounce-save vào IDB
     // - `clearDraft` : xoá IDB + reset về defaults (gọi sau khi submit thành công)
     // - `isRestored` : true nếu giá trị được khôi phục từ lần trước
     // - `setValues`  : set toàn bộ values (dùng khi muốn reset thủ công) */
import { useCallback, useEffect, useRef, useState } from "react";
import { clearModalDraft, getModalDraft, setModalDraft } from "@/lib/modal-draft";

export function useModalDraft<T extends Record<string, unknown>>(key: string, defaults: T) {
  const [values, setValues] = useState<T>(defaults);
  const [isRestored, setIsRestored] = useState(false);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Đọc nháp từ IDB khi key thay đổi (thường chỉ 1 lần lúc mount).
  useEffect(() => {
    getModalDraft<T>(key).then((draft) => {
      if (draft) {
        setValues({ ...defaultsRef.current, ...draft });
        setIsRestored(true);
      } else {
        setValues(defaultsRef.current);
        setIsRestored(false);
      }
    });
  }, [key]);

  // Flush IDB trước khi unmount (tránh mất nháp khi tab bị đóng đột ngột).
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const patch = useCallback(
    (p: Partial<T>) => {
      setValues((prev) => {
        const next = { ...prev, ...p };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          setModalDraft(key, next).catch(() => {});
        }, 400);
        return next;
      });
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    clearModalDraft(key).catch(() => {});
    setValues(defaultsRef.current);
    setIsRestored(false);
  }, [key]);

  return { values, patch, clearDraft, isRestored, setValues };
}
