import { useEffect } from "react";
import { isTypingTarget } from "@/lib/shortcuts";
import { useUI } from "@/stores/ui";
import { useShortcut } from "./useShortcut";

export function useGlobalShortcuts() {
  const setCmdOpen = useUI((s) => s.setCmdOpen);
  const cmdOpen = useUI((s) => s.cmdOpen);
  const setAgentOpen = useUI((s) => s.setAgentOpen);
  const agentOpen = useUI((s) => s.agentOpen);

  // Phím tắt cấu hình được (binding lấy từ preferences tài khoản).
  useShortcut("command-palette", () => setCmdOpen(true));
  useShortcut("toggle-agent", () => setAgentOpen(!agentOpen));

  // "/" mở nhanh Command Palette — phím tắt cố định (không cấu hình), chỉ khi
  // không gõ trong ô nhập và chưa mở palette/agent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !cmdOpen && !agentOpen && !isTypingTarget(document.activeElement)) {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cmdOpen, agentOpen, setCmdOpen]);
}
