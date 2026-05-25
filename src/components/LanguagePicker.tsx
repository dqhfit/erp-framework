import { LANGS, type Lang } from "@/i18n/dict";
/* ==========================================================
   LanguagePicker — Nút toggle gọn VI / EN trên Topbar.
   ========================================================== */
import { useLocale } from "@/stores/locale";

function nextLang(current: Lang): Lang {
  const idx = LANGS.findIndex((l) => l.code === current);
  return LANGS[(idx + 1) % LANGS.length]!.code;
}

export function LanguagePicker() {
  const lang = useLocale((s) => s.lang);
  const setLang = useLocale((s) => s.setLang);
  return (
    <button
      onClick={() => setLang(nextLang(lang))}
      className="h-8 px-2 rounded-md text-xs font-medium text-muted hover:text-text hover:bg-hover/50 transition-colors shrink-0"
      title="Language / Ngôn ngữ"
    >
      {lang.toUpperCase()}
    </button>
  );
}
