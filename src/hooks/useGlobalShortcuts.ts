import { useUI } from "@/stores/ui";
import { useEffect } from "react";

export function useGlobalShortcuts() {
  const setCmdOpen = useUI((s) => s.setCmdOpen);
  const cmdOpen = useUI((s) => s.cmdOpen);
  const setAgentOpen = useUI((s) => s.setAgentOpen);
  const agentOpen = useUI((s) => s.agentOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        setAgentOpen(!agentOpen);
      }
      if (e.key === "/" && !cmdOpen && !agentOpen) {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          setCmdOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cmdOpen, agentOpen, setCmdOpen, setAgentOpen]);
}
