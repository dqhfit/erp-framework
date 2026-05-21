/* ==========================================================
   LanguagePicker — Dropdown nhỏ chọn ngôn ngữ trên Topbar.
   Không dùng flag emoji vì Windows không render được cờ —
   chỉ hiển thị mã + tên ngôn ngữ.
   ========================================================== */
import { Select } from "@/components/ui";
import { useLocale } from "@/stores/locale";
import { LANGS, type Lang } from "@/i18n/dict";

export function LanguagePicker() {
  const lang = useLocale((s) => s.lang);
  const setLang = useLocale((s) => s.setLang);
  return (
    <Select
      className="h-8 text-xs !w-auto pr-7"
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      title="Language / Ngôn ngữ"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.code.toUpperCase()} — {l.label}
        </option>
      ))}
    </Select>
  );
}
