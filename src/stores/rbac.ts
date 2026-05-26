/* ==========================================================
   rbac store — Giữ role của người dùng hiện tại + tiện ích
   kiểm tra quyền. Persist localStorage. Đây là RBAC "client
   side" cho app builder: chặn UI theo role. Khi deploy thật,
   role nên được xác thực lại ở backend/bridge.
   ========================================================== */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type Action, type ObjectType, type Role, roleCan } from "@/lib/permissions";

interface RbacState {
  /** Role của phiên hiện tại. Mặc định admin (single-user dev). */
  role: Role;
  /** Bật/tắt enforcement — tắt thì can() luôn true (dev tiện). */
  enforce: boolean;
  setRole: (r: Role) => void;
  setEnforce: (v: boolean) => void;
  /** Kiểm tra quyền theo role hiện tại + cờ enforce. */
  can: (action: Action, obj: ObjectType) => boolean;
}

export const useRbac = create<RbacState>()(
  persist(
    (set, get) => ({
      role: "admin",
      enforce: false,
      setRole: (r) => set({ role: r }),
      setEnforce: (v) => set({ enforce: v }),
      can: (action, obj) => {
        const s = get();
        if (!s.enforce) return true;
        return roleCan(s.role, action, obj);
      },
    }),
    { name: "erp-rbac" },
  ),
);

/** Helper ngoài React — kiểm tra quyền nhanh. */
export function can(action: Action, obj: ObjectType): boolean {
  return useRbac.getState().can(action, obj);
}
