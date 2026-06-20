/* FavoritesSection — danh sách trang yêu thích (ghim) dưới Home. */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { I } from "@/components/Icons";
import type { FavItem } from "@/components/sidebar/favs";
import { useT } from "@/hooks/useT";
import type { IconName } from "@/lib/object-types";
import { cn } from "@/lib/utils";

/* ─── FavoritesSection — danh sách yêu thích dưới Home ─────── */
export function FavoritesSection({
  favs,
  onRemove,
  pathname,
  collapsed,
}: {
  favs: FavItem[];
  onRemove: (id: string) => void;
  pathname: string;
  collapsed: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("sb-favs-open") !== "false";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem("sb-favs-open", String(next));
    } catch {}
  };

  if (favs.length === 0) return null;

  return (
    <div className="border-b border-border/40 pb-0.5">
      {!collapsed && (
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center gap-1 px-3 pt-2 pb-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted/50 hover:text-muted transition-colors"
        >
          <I.ChevronRight
            size={9}
            className={cn("transition-transform shrink-0", open && "rotate-90")}
          />
          <I.Star size={9} className="shrink-0 text-warning/70" />
          <span>{t("sidebar.favorites")}</span>
        </button>
      )}
      {(collapsed || open) &&
        favs.map((fav) => {
          const IconC = (I[fav.iconName as IconName] ?? I.Star) as React.ComponentType<{
            size: number;
          }>;
          return (
            <div key={fav.id} className={cn("relative group", !collapsed && "pl-3")}>
              <Link
                to={fav.to}
                className={cn(
                  "sidebar-item",
                  pathname === fav.to && "active",
                  !collapsed && "pr-7",
                )}
                title={fav.label}
              >
                <span className="icon text-muted shrink-0">
                  <IconC size={14} />
                </span>
                {!collapsed && <span className="truncate flex-1 text-[13px]">{fav.label}</span>}
              </Link>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => onRemove(fav.id)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-sm flex items-center justify-center text-muted/30 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t("sidebar.remove_favorite")}
                >
                  <I.X size={10} />
                </button>
              )}
            </div>
          );
        })}
    </div>
  );
}
