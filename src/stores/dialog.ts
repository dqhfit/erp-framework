/* ==========================================================
   dialog store — Modal-based alternative cho native
   alert/confirm/prompt. Một dialog tại 1 thời điểm.
   ========================================================== */
import { create } from "zustand";

export type DialogKind = "alert" | "confirm" | "prompt";

export interface DialogRequest {
  kind: DialogKind;
  title: string;
  message?: string;
  /** Cho prompt: giá trị mặc định trong input */
  defaultValue?: string;
  /** Cho prompt: placeholder */
  placeholder?: string;
  confirmText: string;
  cancelText: string;
  /** Hiển thị nút xác nhận màu đỏ (cho delete) */
  danger?: boolean;
  /** Promise resolver — internal */
  resolve: (result: boolean | string | null) => void;
}

interface DialogState {
  current: DialogRequest | null;
  open: (req: DialogRequest) => void;
  close: (result: boolean | string | null) => void;
}

export const useDialog = create<DialogState>((set, get) => ({
  current: null,
  open: (req) => set({ current: req }),
  close: (result) => {
    const cur = get().current;
    if (cur) cur.resolve(result);
    set({ current: null });
  },
}));
