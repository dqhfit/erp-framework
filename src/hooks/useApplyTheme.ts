import { useUI } from "@/stores/ui";
import { useEffect } from "react";

export function useApplyTheme() {
  const { theme, accent, density } = useUI();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("density-compact", density === "compact");
    (["violet", "cyan", "green", "amber"] as const).forEach((a) =>
      root.classList.toggle(`accent-${a}`, accent === a && a !== "violet"),
    );
  }, [theme, accent, density]);
}
