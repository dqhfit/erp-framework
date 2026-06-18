/* preferences.ts — Zustand store cho cài đặt giao diện per-user.
   Load 1 lần khi login, debounce save lên server. */
import { createObjectsClient } from "@erp-framework/client";
import { create } from "zustand";

const api = createObjectsClient("");

export interface SidebarFavItem {
  id: string;
  to: string;
  label: string;
  iconName: string;
}

export interface UserPreferences {
  portal?: {
    lastPageId?: string;
  };
  /** Danh sách yêu thích sidebar — sync across browsers qua server. */
  sidebarFavorites?: SidebarFavItem[];
  /** Phím tắt do người dùng tự đặt (override mặc định): { shortcutId: combo }.
   *  combo canonical, vd "mod+shift+p". Giá trị undefined = khôi phục mặc định
   *  (server bỏ key undefined khi lưu JSON). Xem src/lib/shortcuts.ts. */
  shortcuts?: Record<string, string | undefined>;
  /** Màu nền ô/dòng có giá trị thay đổi chưa lưu (hex, vd "#fdb105").
   *  undefined = dùng mặc định amber từ CSS var. */
  changedCellBg?: string;
}

interface PreferencesState {
  prefs: UserPreferences;
  loaded: boolean;
  load: () => Promise<void>;
  /** Merge patch vào prefs local và debounce save lên server (800ms). */
  save: (patch: UserPreferences) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const usePreferences = create<PreferencesState>()((set, get) => ({
  prefs: {},
  loaded: false,

  load: async () => {
    try {
      const data = await api.preferences.load();
      set({ prefs: data as UserPreferences, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  save: (patch) => {
    const merged = { ...get().prefs, ...patch };
    // Deep-merge 1 cấp cho các sub-object (portal, etc.)
    for (const k of Object.keys(patch) as (keyof UserPreferences)[]) {
      const pv = patch[k];
      const bv = get().prefs[k];
      if (pv && typeof pv === "object" && !Array.isArray(pv) && bv && typeof bv === "object") {
        (merged as Record<string, unknown>)[k] = { ...bv, ...pv };
      }
    }
    set({ prefs: merged });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void api.preferences.save(merged as Record<string, unknown>);
    }, 800);
  },
}));
