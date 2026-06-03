import { useCallback, useSyncExternalStore } from "react";

/** Theo dõi một media query (vd "(max-width: 767.98px)"). Dùng
   useSyncExternalStore (React 19) để khớp render server/client, tránh
   hydration mismatch. SSR: trả false (mặc định desktop). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      // API mới (addEventListener) — không dùng addListener đã deprecated.
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Mobile = viewport < 768px (md). 767.98 tránh trùng đúng 1px với
   breakpoint md=768 của Tailwind. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767.98px)");
}
