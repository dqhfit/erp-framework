import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

const DEFAULT = "ERP Framework";
const EDIT_PREFIX = "[EDIT] ";
const PORTAL_PREFIX = "[PORTAL] ";

export function useDocumentTitle(name: string | undefined) {
  const location = useLocation();
  const isEditPage = location.pathname.startsWith("/pages/") && location.pathname !== "/pages";
  const isPortalPage = location.pathname === "/portal";

  useEffect(() => {
    let title = DEFAULT;
    if (name) {
      title = `${name} — ERP`;
    }
    if (isEditPage) {
      title = `${EDIT_PREFIX}${title}`;
    } else if (isPortalPage) {
      title = `${PORTAL_PREFIX}${title}`;
    }
    document.title = title;

    // Update favicon based on page type
    if (typeof window !== "undefined" && window.updateFavicon) {
      if (isEditPage) {
        window.updateFavicon("edit");
      } else if (isPortalPage) {
        window.updateFavicon("portal");
      } else {
        window.updateFavicon("default");
      }
    }

    return () => {
      document.title = DEFAULT;
      if (typeof window !== "undefined" && window.updateFavicon) {
        window.updateFavicon("default");
      }
    };
  }, [name, isEditPage, isPortalPage]);
}
