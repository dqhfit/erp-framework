import { useEffect } from "react";
import { usePreferences } from "@/stores/preferences";
import { useUI } from "@/stores/ui";

export function useApplyTheme() {
  const { theme, accent, density } = useUI();
  const changedCellBg = usePreferences((s) => s.prefs.changedCellBg);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("density-compact", density === "compact");
    (["violet", "cyan", "green", "amber"] as const).forEach((a) => {
      root.classList.toggle(`accent-${a}`, accent === a && a !== "violet");
    });
  }, [theme, accent, density]);

  // Áp màu ô thay đổi lên CSS var — override default amber trong index.css.
  useEffect(() => {
    const root = document.documentElement;
    if (!changedCellBg) {
      root.style.removeProperty("--changed-row-bg");
      root.style.removeProperty("--changed-cell-bg");
      return;
    }
    const r = parseInt(changedCellBg.slice(1, 3), 16);
    const g = parseInt(changedCellBg.slice(3, 5), 16);
    const b = parseInt(changedCellBg.slice(5, 7), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return;
    root.style.setProperty("--changed-row-bg", `rgba(${r},${g},${b},0.10)`);
    root.style.setProperty("--changed-cell-bg", `rgba(${r},${g},${b},0.22)`);
  }, [changedCellBg]);
}
