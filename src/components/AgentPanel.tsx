import { useState, useEffect, useRef, useMemo } from "react";
import { useUI } from "@/stores/ui";
import { I } from "@/components/Icons";
import { Button, Chip, Textarea, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { llmRegistry } from "@/core/llm";
import { useSettings } from "@/stores/settings";
import { useMcpClient, callMcpTool } from "@/hooks/useMcpClient";
import { runAgent, mcpToolsToToolDefs } from "@/core/agent-runner";
import { useT } from "@/hooks/useT";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCall?: { name: string; args: string };
  suggestions?: string[];
  pending?: boolean;
  error?: boolean;
}

const SYSTEM_PROMPT = `Bạn là Trợ lý ERP thân thiện cho doanh nghiệp Việt Nam.
Quy tắc:
- Trả lời tiếng Việt, ngắn gọn, lịch sự.
- Trước khi tạo / sửa dữ liệu, hãy xác nhận lại với người dùng.
- Khi cần, đề xuất 2-3 hành động tiếp theo dưới dạng câu hỏi ngắn.`;

const SEED: Message[] = [
  {
    id: "m1",
    role: "assistant",
    content: "Xin chào Toàn! Mình là **Trợ lý ERP**. Hôm nay bạn muốn làm gì?\n\n• Tạo đơn hàng nhanh\n• Tìm khách hàng\n• Xem báo cáo doanh số",
    suggestions: ["Tạo đơn cho KH 'Minh Phúc'", "Doanh số tuần này", "Đơn chờ duyệt > 50tr"],
  },
];

export function AgentPanel() {
  const t = useT();
  const open = useUI((s) => s.agentOpen);
  const setOpen = useUI((s) => s.setAgentOpen);
  const llmProfiles = useSettings((s) => s.llmProfiles);
  const profileNames = useMemo(() => Object.keys(llmProfiles), [llmProfiles]);
  const { tools: mcpTools } = useMcpClient();
  const [profileName, setProfileName] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>(SEED);
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-pick first profile khả dụng (có key HOẶC adapter no-key như claude-cli/claude-pro/ollama)
  useEffect(() => {
    if (!profileName && profileNames.length) {
      const usable = profileNames.find((n) => {
        const p = llmProfiles[n];
        if (!p) return false;
        return llmRegistry.isUsable(p);
      });
      setProfileName(usable ?? profileNames[0]!);
    }
  }, [profileNames, profileName, llmProfiles]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { id: `u${Date.now()}`, role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setInput("");

    const profile = profileName ? llmProfiles[profileName] : undefined;
    if (!profile || !llmRegistry.isUsable(profile)) {
      setMessages((m) => [...m, {
        id: `a${Date.now()}`, role: "assistant", error: true,
        content: profile
          ? t("agent.profile_not_usable", { name: profile.name, adapter: profile.adapter })
          : t("agent.no_llm_msg"),
        suggestions: ["LLM Settings"],
      }]);
      return;
    }

    // Pending message
    const pendingId = `a${Date.now()}`;
    setMessages((m) => [...m, {
      id: pendingId, role: "assistant", content: "", pending: true,
      toolCall: { name: profile.adapter + ":" + profile.model, args: "thinking..." },
    }]);

    try {
      const history = messages
        .filter((m) => !m.pending && !m.error)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const toolDefs = mcpTools.length ? mcpToolsToToolDefs(mcpTools) : [];

      const result = await runAgent({
        profileName: profile.name,
        system: SYSTEM_PROMPT + (toolDefs.length
          ? `\n\nBạn có quyền gọi ${toolDefs.length} MCP tool để truy vấn dữ liệu thật. Hãy gọi tool khi cần.`
          : ""),
        userPrompt: text,
        history,
        tools: toolDefs,
        callTool: (name, args) => callMcpTool(name, args),
        maxIterations: 5,
        onEvent: (ev) => {
          if (ev.type === "tool_call") {
            // Append một message hiển thị tool call đang chạy
            setMessages((m) => [...m, {
              id: `t${ev.id}`, role: "assistant", content: "",
              toolCall: { name: ev.name, args: JSON.stringify(ev.args).slice(0, 80) },
              pending: true,
            }]);
          } else if (ev.type === "tool_result") {
            setMessages((m) => m.map((msg) => msg.id === `t${ev.id}` ? {
              ...msg,
              pending: false,
              content: ev.error
                ? `✗ ${ev.name} → ${ev.error}`
                : `✓ ${ev.name} → ${summarizeResult(ev.result)}`,
              error: !!ev.error,
              toolCall: undefined,
            } : msg));
          }
        },
      });

      setMessages((m) => m.map((msg) =>
        msg.id === pendingId
          ? { ...msg, content: result.text || "(không có nội dung)", pending: false, toolCall: undefined }
          : msg
      ));
    } catch (err) {
      setMessages((m) => m.map((msg) =>
        msg.id === pendingId
          ? { ...msg, content: `Lỗi: ${(err as Error).message}`, pending: false, error: true, toolCall: undefined }
          : msg
      ));
    }
  };

  function summarizeResult(r: unknown): string {
    if (r == null) return "(empty)";
    if (typeof r === "string") return r.length > 100 ? r.slice(0, 100) + "..." : r;
    if (Array.isArray(r)) return `${r.length} item`;
    const s = JSON.stringify(r);
    return s.length > 100 ? s.slice(0, 100) + "..." : s;
  }

  if (!open) return null;

  return (
    <aside className="fixed right-0 top-12 bottom-0 w-[400px] bg-panel border-l border-border flex flex-col z-40 shadow-2xl">
      {/* Header */}
      <div className="h-12 shrink-0 px-3 flex items-center gap-2 border-b border-border">
        <span className="w-7 h-7 rounded-md flex items-center justify-center text-white"
              style={{ background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))" }}>
          <I.Sparkles size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{t("agent.title")}</div>
          <div className="text-[11px] text-muted font-mono truncate">
            {profileName ? (llmProfiles[profileName]?.model ?? profileName) : t("agent.no_profile")}
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={<I.X size={14} />} onClick={() => setOpen(false)} />
      </div>

      {/* Profile selector */}
      {profileNames.length > 0 && (
        <div className="px-3 py-2 border-b border-border shrink-0 bg-panel-2/30">
          <Select value={profileName} onChange={(e) => setProfileName(e.target.value)} className="text-xs">
            {profileNames.map((n) => {
              const p = llmProfiles[n];
              const usable = p ? llmRegistry.isUsable(p) : false;
              return <option key={n} value={n}>{n} {usable ? t("agent.usable") : t("agent.not_usable")}</option>;
            })}
          </Select>
        </div>
      )}

      {/* Messages */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m) => <MessageBubble key={m.id} msg={m} onSuggest={send} />)}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border shrink-0">
        <Textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(input); }
          }}
          placeholder={t("agent.input_placeholder")}
          className="text-sm"
        />
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon={<I.Mic size={13} />} title="Voice" />
          </div>
          <Button variant="primary" size="sm" icon={<I.Send size={13} />} onClick={() => send(input)} disabled={!input.trim()}>
            {t("agent.send")}
          </Button>
        </div>
      </div>
    </aside>
  );
}

function MessageBubble({ msg, onSuggest }: { msg: Message; onSuggest: (text: string) => void }) {
  const t = useT();
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2", isUser && "flex-row-reverse")}>
      <span className={cn(
        "w-7 h-7 shrink-0 rounded-md flex items-center justify-center",
        isUser ? "bg-accent text-white" : "bg-panel-2 border border-border",
      )}>
        {isUser ? <I.User size={13} /> : <I.Sparkles size={13} className="text-accent" />}
      </span>
      <div className="flex-1 min-w-0 max-w-[85%]">
        <div className={cn(
          "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
          msg.error ? "bg-danger/10 border border-danger/30 text-danger" :
          isUser ? "bg-accent/20 text-text" : "bg-panel-2 border border-border",
        )}>
          {msg.pending && !msg.content ? (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <I.Loader size={13} className="animate-spin" /> {t("agent.thinking")}
            </span>
          ) : msg.content}
        </div>
        {msg.toolCall && (
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <Chip variant="accent" className="font-mono">
              <I.Loader size={10} className="animate-spin" /> {msg.toolCall.name}
            </Chip>
          </div>
        )}
        {msg.suggestions && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {msg.suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onSuggest(s)}
                className="text-[11px] px-2 py-0.5 rounded border border-border bg-bg-soft hover:bg-hover/40"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
