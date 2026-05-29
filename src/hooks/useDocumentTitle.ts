import { useEffect } from "react";

const DEFAULT = "ERP Framework";

export function useDocumentTitle(name: string | undefined) {
  useEffect(() => {
    document.title = name ? `${name} — ERP` : DEFAULT;
    return () => {
      document.title = DEFAULT;
    };
  }, [name]);
}
