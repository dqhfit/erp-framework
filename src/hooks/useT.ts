/* ==========================================================
   useT — React hook trả về hàm dịch t(key, params).
   - Trong component: const t = useT(); t('common.save')
   - Ngoài component: import { t } from "@/hooks/useT"
   ========================================================== */
import { useCallback } from "react";
import { tFromDict } from "@/i18n/dict";
import { useLocale } from "@/stores/locale";

export function useT() {
  const lang = useLocale((s) => s.lang);
  return useCallback(
    (key: string, params?: Record<string, string | number>): string => tFromDict(lang, key, params),
    [lang],
  );
}

/** Non-React helper — đọc lang từ store qua getState() */
export function t(key: string, params?: Record<string, string | number>): string {
  return tFromDict(useLocale.getState().lang, key, params);
}
