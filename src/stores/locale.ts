import type { Lang } from "@/i18n/dict";
/* ==========================================================
   locale store — Persist ngôn ngữ hiện tại (vi/en).
   ========================================================== */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LocaleState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLocale = create<LocaleState>()(
  persist(
    (set) => ({
      lang: "vi" as Lang,
      setLang: (lang) => set({ lang }),
    }),
    { name: "erp-locale" },
  ),
);
