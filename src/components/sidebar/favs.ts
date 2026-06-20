/* Favorites (yêu thích) sidebar — nguồn chân lý là preferences store nên
   mọi nơi gọi useFavs (sidebar + trang chủ) đồng bộ tức thì khi ghim/bỏ.
   Cache localStorage (`sb-favs`) để render ngay trước khi prefs tải xong. */
import { useEffect } from "react";
import { type SidebarFavItem, usePreferences } from "@/stores/preferences";

// FavItem tái sử dụng SidebarFavItem từ preferences store để đảm bảo cùng
// shape khi lưu/đọc từ server.
export type FavItem = SidebarFavItem;

function readFavsCache(): FavItem[] {
  try {
    const r = localStorage.getItem("sb-favs");
    return r ? (JSON.parse(r) as FavItem[]) : [];
  } catch {
    return [];
  }
}
function writeFavsCache(favs: FavItem[]): void {
  try {
    localStorage.setItem("sb-favs", JSON.stringify(favs));
  } catch {}
}

export function useFavs() {
  const prefs = usePreferences((s) => s.prefs);
  const savePrefs = usePreferences((s) => s.save);
  const loaded = usePreferences((s) => s.loaded);

  // NGUỒN CHÂN LÝ là preferences store → MỌI nơi gọi useFavs (sidebar + trang
  // chủ) đồng bộ TỨC THÌ khi ghim/bỏ ghim (cùng subscribe `prefs`, cùng re-render).
  // Trước khi server trả về (loaded=false) dùng cache localStorage để render ngay.
  const favs: FavItem[] = loaded
    ? ((prefs.sidebarFavorites as FavItem[] | undefined) ?? [])
    : readFavsCache();

  // Giữ cache localStorage khớp dữ liệu server (cho lần mở app sau render ngay).
  useEffect(() => {
    if (loaded) writeFavsCache((prefs.sidebarFavorites as FavItem[] | undefined) ?? []);
  }, [loaded, prefs.sidebarFavorites]);

  const save = (next: FavItem[]) => {
    // Cập nhật cache trước (nguồn đọc khi !loaded), rồi store (re-render mọi
    // consumer ngay) + debounce ghi server — qua preferences store.
    writeFavsCache(next);
    savePrefs({ sidebarFavorites: next });
  };

  return {
    favs,
    isFav: (id: string) => favs.some((f) => f.id === id),
    toggle: (item: FavItem) =>
      save(
        favs.some((f) => f.id === item.id) ? favs.filter((f) => f.id !== item.id) : [...favs, item],
      ),
    remove: (id: string) => save(favs.filter((f) => f.id !== id)),
  };
}
