import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

const DEFAULT = "ERP Framework";
const EDIT_PREFIX = "[EDIT] ";
const PORTAL_PREFIX = "[PORTAL] ";

type FaviconWindow = Window & {
  updateFavicon?: (mode: "default" | "edit" | "portal") => void;
};

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
    const faviconWindow = window as FaviconWindow;
    if (faviconWindow.updateFavicon) {
      if (isEditPage) {
        faviconWindow.updateFavicon("edit");
      } else if (isPortalPage) {
        faviconWindow.updateFavicon("portal");
      } else {
        faviconWindow.updateFavicon("default");
      }
    }

    return () => {
      document.title = DEFAULT;
      if (faviconWindow.updateFavicon) {
        faviconWindow.updateFavicon("default");
      }
    };
  }, [name, isEditPage, isPortalPage]);
}
