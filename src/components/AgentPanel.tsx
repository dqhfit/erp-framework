import { createAgentChatClient, createKnowledgeClient } from "@erp-framework/client";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import { Button, Chip, Select, Textarea } from "@/components/ui";
import { mcpToolsToToolDefs } from "@/core/agent-runner";
import { llmRegistry } from "@/core/llm";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { roleCan } from "@/lib/permissions";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useRbac } from "@/stores/rbac";
import { useSettings } from "@/stores/settings";
import { formatAgentContext, useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

/* Client Knowledge Base — dùng cho nút "Lưu vào tri thức" trên tin nhắn. */
const kb = createKnowledgeClient("");
/* Client lịch sử trò chuyện (lưu / liệt kê / xoá). */
const chatHistory = createAgentChatClient("");

interface ConversationItem {
  id: string;
  title: string;
  agentId: string | null;
  updatedAt: string | Date;
}

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
    content:
      "Xin chào Toàn! Mình là **Trợ lý ERP**. Hôm nay bạn muốn làm gì?\n\n• Tạo đơn hàng nhanh\n• Tìm khách hàng\n• Xem báo cáo doanh số",
    suggestions: ["Tạo đơn cho KH 'Minh Phúc'", "Doanh số tuần này", "Đơn chờ duyệt > 50tr"],
  },
];

export function AgentPanel() {
  const t = useT();
  // Khi đang ở /agents/$id → bind chat với agent đó: server đọc memory
  // + dùng model (+ fallback) của agent thay cho profileName của user.
  // Fallback priority (xem plan ph-n-t-ch-to-n-b-iterative-hammock):
  //   1. URL /agents/$id   2. primary của user   3. CEO của company   4. null
  const pathname = useLocation({ select: (l) => l.pathname });
  const primaryAgentId = useAuth((s) => s.primaryAgentId);
  const allAgents = useUserObjects((s) => s.agents);
  const boundAgentId = useMemo(() => {
    const m = pathname.match(/^\/agents\/([^/?#]+)/);
    if (m && m[1] !== "$id") return m[1];
    if (primaryAgentId && allAgents.find((a) => a.id === primaryAgentId)) {
      return primaryAgentId;
    }
    // CEO mặc định: tìm agent tên "CEO" trong company (đã seed). So sánh
    // case-insensitive để tránh lệch viết hoa.
    const ceo = allAgents.find((a) => a.name.toLowerCase() === "ceo");
    return ceo?.id ?? null;
  }, [pathname, primaryAgentId, allAgents]);
  // RBAC — chỉ hiện nút "Lưu vào tri thức" khi có quyền create:knowledge.
  const rbacRole = useRbac((s) => s.role);
  const rbacEnforce = useRbac((s) => s.enforce);
  const canAddKb = !rbacEnforce || roleCan(rbacRole, "create", "knowledge");
  const open = useUI((s) => s.agentOpen);
  const setOpen = useUI((s) => s.setAgentOpen);
  const setMobileNavOpen = useUI((s) => s.setMobileNavOpen);
  const isMobile = useIsMobile();
  const agentContext = useUI((s) => s.agentContext);

  // Mobile: panel full-width chiếm trọn → đóng off-canvas nav để tránh chồng lớp.
  useEffect(() => {
    if (isMobile && open) setMobileNavOpen(false);
  }, [isMobile, open, setMobileNavOpen]);
  const llmProfiles = useSettings((s) => s.llmProfiles);
  const profileNames = useMemo(() => Object.keys(llmProfiles), [llmProfiles]);
  const { tools: mcpTools } = useMcpClient();
  const [profileName, setProfileName] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>(SEED);
  const [input, setInput] = useState("");
  // "Tìm sâu": bật query-rewrite + CRAG grading phía server (orchestrated
  // Agentic RAG). Mặc định tắt cho nhanh/rẻ. Xem AGENTIC-RAG-DESIGN §1.5.
  const [deepSearch, setDeepSearch] = useState(false);
  // "Định tuyến": bật Query routing — server phân loại ý định câu hỏi → KB /
  // dữ liệu bản ghi / web / trả lời thẳng. Mặc định tắt. Xem §11.
  const [smartRoute, setSmartRoute] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Lịch sử trò chuyện (lưu server, per-user). conversationId = cuộc đang mở
  // (null = cuộc mới chưa lưu). bodyRef vẫn dùng cho auto-scroll.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadConversations = () => {
    chatHistory
      .list()
      .then((rows) => setConversations(rows as ConversationItem[]))
      .catch(() => {
        /* chưa đăng nhập / lỗi mạng — bỏ qua, lịch sử trống */
      });
  };
  // Nạp danh sách khi mở panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ phụ thuộc open
  useEffect(() => {
    if (open) loadConversations();
  }, [open]);

  /** Mở 1 cuộc trò chuyện cũ: nạp tin nhắn từ server vào khung chat. */
  const openConversation = async (id: string) => {
    try {
      const msgs = await chatHistory.messages(id);
      setMessages(
        msgs.map((m, i) => ({
          id: `h${i}`,
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      );
      setConversationId(id);
      setShowHistory(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  /** Bắt đầu cuộc trò chuyện mới (chưa lưu tới khi gửi tin đầu). */
  const newChat = () => {
    setMessages(SEED);
    setConversationId(null);
    setShowHistory(false);
  };

  const deleteConversation = async (id: string, title: string) => {
    const ok = await dialog.confirm(`Xoá cuộc trò chuyện "${title}"?`, {
      title: "Xoá lịch sử",
      danger: true,
      confirmText: "Xoá",
    });
    if (!ok) return;
    try {
      await chatHistory.delete(id);
      if (conversationId === id) newChat();
      loadConversations();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Auto-pick first profile khả dụng (có key HOẶC adapter no-key như claude-cli/claude-pro/ollama)
  useEffect(() => {
    if (!profileName && profileNames.length) {
      const usable = profileNames.find((n) => {
        const p = llmProfiles[n];
        if (!p) return false;
        return llmRegistry.isUsable(p);
      });
      // profileNames.length > 0 đã được if-guard ở scope ngoài (xem caller).
      const fallback = profileNames[0];
      if (usable || fallback) setProfileName(usable ?? fallback ?? "");
    }
  }, [profileNames, profileName, llmProfiles]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, []);

  const send = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { id: `u${Date.now()}`, role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setInput("");

    const profile = profileName ? llmProfiles[profileName] : undefined;
    if (!profile || !llmRegistry.isUsable(profile)) {
      setMessages((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          error: true,
          content: profile
            ? t("agent.profile_not_usable", { name: profile.name, adapter: profile.adapter })
            : t("agent.no_llm_msg"),
          suggestions: ["LLM Settings"],
        },
      ]);
      return;
    }

    // Pending message
    const pendingId = `a${Date.now()}`;
    setMessages((m) => [
      ...m,
      {
        id: pendingId,
        role: "assistant",
        content: "",
        pending: true,
        toolCall: { name: `${profile.adapter}:${profile.model}`, args: "thinking..." },
      },
    ]);

    try {
      const history = messages
        .filter((m) => !m.pending && !m.error && m.id !== userMsg.id)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      // Khi gắn agent có cấu hình allowlist tool (config.tools) → chỉ gửi các
      // tool agent được phép (server cũng enforce fail-closed, #3b). Config
      // rỗng/thiếu `tools` → gửi tất cả (tương thích agent cũ).
      let toolDefs = mcpTools.length ? mcpToolsToToolDefs(mcpTools) : [];
      if (boundAgentId) {
        const cfg = useUserObjects.getState().agentContent[boundAgentId] as
          | { tools?: unknown }
          | undefined;
        if (Array.isArray(cfg?.tools)) {
          const allow = new Set(cfg.tools.filter((x): x is string => typeof x === "string"));
          toolDefs = toolDefs.filter((t) => allow.has(t.name));
        }
      }

      // Gọi agent backend — server chạy vòng lặp LLM + MCP tool, phát
      // event theo từng bước qua SSE.
      const res = await fetch("/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          profileName: profile.name,
          system:
            SYSTEM_PROMPT +
            (agentContext
              ? `\n\nNgười dùng đang xem ${formatAgentContext(agentContext)} (id: ${agentContext.id}). Ưu tiên trả lời câu hỏi liên quan đến đối tượng này.`
              : "") +
            (toolDefs.length
              ? `\n\nBạn có ${toolDefs.length} MCP tool — gọi khi cần truy vấn dữ liệu thật.`
              : ""),
          messages: [...history, { role: "user", content: text }],
          tools: toolDefs,
          // Đang ở /agents/$id → bind với agent đó: server dùng model
          // (+ fallback) và memory files của agent thay cho profileName.
          ...(boundAgentId ? { agentId: boundAgentId } : {}),
          // "Tìm sâu" → server bật plan + grade trong auto-RAG.
          deepSearch,
          // "Định tuyến" → server phân loại nguồn (KB/records/web/direct).
          smartRoute,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Server ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalText = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let ev: { type?: string; [k: string]: unknown };
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (ev.type === "text" || ev.type === "done") {
            finalText = (ev.text as string) || finalText;
          } else if (ev.type === "tool_call") {
            const args = JSON.stringify(ev.args ?? {}).slice(0, 80);
            setMessages((m) => [
              ...m,
              {
                id: `t${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                role: "assistant",
                content: "",
                toolCall: { name: String(ev.name), args },
                pending: true,
              },
            ]);
          } else if (ev.type === "tool_result") {
            setMessages((m) => {
              const ri = [...m].reverse().findIndex((x) => x.pending && !!x.toolCall);
              if (ri < 0) return m;
              const idx = m.length - 1 - ri;
              const copy = [...m];
              const target = copy[idx];
              if (!target) return m;
              copy[idx] = {
                ...target,
                pending: false,
                toolCall: undefined,
                error: !!ev.error,
                content: ev.error
                  ? `✗ ${String(ev.name)} → ${String(ev.error)}`
                  : `✓ ${String(ev.name)} → ${summarizeResult(ev.result)}`,
              };
              return copy;
            });
          } else if (ev.type === "error") {
            throw new Error(String(ev.message ?? "lỗi không rõ"));
          }
        }
      }

      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingId
            ? {
                ...msg,
                content: finalText || "(không có nội dung)",
                pending: false,
                toolCall: undefined,
              }
            : msg,
        ),
      );

      // Lưu lượt trao đổi vào lịch sử (tạo cuộc mới nếu chưa có). Fail-safe:
      // lỗi lưu KHÔNG làm vỡ chat.
      if (finalText) {
        chatHistory
          .saveExchange({
            conversationId,
            agentId: boundAgentId,
            userText: text,
            assistantText: finalText,
          })
          .then((r) => {
            if (!conversationId) {
              setConversationId(r.conversationId);
              loadConversations();
            }
          })
          .catch(() => {
            /* lưu lịch sử lỗi — bỏ qua */
          });
      }
    } catch (err) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingId
            ? {
                ...msg,
                content: `Lỗi: ${(err as Error).message}`,
                pending: false,
                error: true,
                toolCall: undefined,
              }
            : msg,
        ),
      );
    }
  };

  function summarizeResult(r: unknown): string {
    if (r == null) return "(empty)";
    if (typeof r === "string") return r.length > 100 ? `${r.slice(0, 100)}...` : r;
    if (Array.isArray(r)) return `${r.length} item`;
    const s = JSON.stringify(r);
    return s.length > 100 ? `${s.slice(0, 100)}...` : s;
  }

  if (!open) return null;

  return (
    <aside
      className={cn(
        "fixed right-0 top-9 bottom-0 bg-panel border-l border-border flex flex-col z-40 shadow-2xl",
        isMobile ? "left-0 w-full" : "w-[400px]",
      )}
    >
      {/* Header */}
      <div className="h-9 shrink-0 px-3 flex items-center gap-2 border-b border-border">
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center text-white"
          style={{
            background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
          }}
        >
          <I.Sparkles size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{t("agent.title")}</div>
          <div className="text-[11px] text-muted font-mono truncate">
            {profileName ? (llmProfiles[profileName]?.model ?? profileName) : t("agent.no_profile")}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<I.Plus size={14} />}
          title="Cuộc trò chuyện mới"
          onClick={newChat}
        />
        <Button
          variant={showHistory ? "default" : "ghost"}
          size="sm"
          icon={<I.Clock size={14} />}
          title="Lịch sử trò chuyện"
          onClick={() => {
            if (!showHistory) loadConversations();
            setShowHistory((v) => !v);
          }}
        />
        <Button variant="ghost" size="sm" icon={<I.X size={14} />} onClick={() => setOpen(false)} />
      </div>

      {/* Panel lịch sử trò chuyện */}
      {showHistory && (
        <div className="shrink-0 max-h-[45%] overflow-y-auto border-b border-border bg-bg-soft/40">
          <div className="px-3 py-2 flex items-center justify-between sticky top-0 bg-panel border-b border-border">
            <span className="text-xs font-semibold">Lịch sử ({conversations.length})</span>
            {conversations.length > 0 && (
              <button
                type="button"
                className="text-[11px] text-muted hover:text-danger underline"
                onClick={async () => {
                  const ok = await dialog.confirm("Xoá TẤT CẢ lịch sử trò chuyện?", {
                    title: "Xoá toàn bộ",
                    danger: true,
                    confirmText: "Xoá hết",
                  });
                  if (!ok) return;
                  await chatHistory.deleteAll().catch(() => {});
                  newChat();
                  loadConversations();
                }}
              >
                Xoá hết
              </button>
            )}
          </div>
          {conversations.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted">Chưa có cuộc trò chuyện nào.</div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "px-3 py-2 flex items-center gap-2 border-b border-border/40 hover:bg-bg-soft cursor-pointer",
                  conversationId === c.id && "bg-accent/10",
                )}
                onClick={() => openConversation(c.id)}
              >
                <I.MessageSquare size={12} className="text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate">{c.title}</div>
                  <div className="text-[10px] text-muted">
                    {new Date(c.updatedAt).toLocaleString("vi-VN", { hour12: false })}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-muted hover:text-danger p-1 rounded hover:bg-danger/10 shrink-0"
                  title="Xoá"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteConversation(c.id, c.title);
                  }}
                >
                  <I.Trash size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Profile selector — group theo adapter (combobox xổ xuống). */}
      {profileNames.length > 0 && (
        <div className="px-3 py-2 border-b border-border shrink-0 bg-panel-2/30">
          <Select
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            className="text-xs"
          >
            {Object.entries(
              profileNames.reduce<Record<string, string[]>>((acc, n) => {
                const ad = llmProfiles[n]?.adapter ?? "khác";
                if (!acc[ad]) acc[ad] = [];
                acc[ad].push(n);
                return acc;
              }, {}),
            ).map(([ad, names]) => (
              <optgroup key={ad} label={ad}>
                {names.map((n) => {
                  const p = llmProfiles[n];
                  const usable = p ? llmRegistry.isUsable(p) : false;
                  return (
                    <option key={n} value={n}>
                      {n} — {p?.model ?? "?"} {usable ? t("agent.usable") : t("agent.not_usable")}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </Select>
        </div>
      )}

      {/* Badge đối tượng đang xem */}
      {agentContext && (
        <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-center gap-1.5 bg-accent/5">
          <I.Sparkles size={11} className="text-accent shrink-0" />
          <span className="text-[11px] text-muted truncate">
            Đang xem:{" "}
            <span className="text-accent font-medium">{formatAgentContext(agentContext)}</span>
          </span>
        </div>
      )}

      {/* Messages */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} onSuggest={send} canSaveKb={canAddKb} />
        ))}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border shrink-0">
        <Textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter gửi; Shift+Enter xuống dòng. Bỏ qua khi đang gõ IME (tiếng
            // Việt) — Enter lúc đó là xác nhận ký tự, không phải gửi.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={t("agent.input_placeholder")}
          className="text-sm"
        />
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon={<I.Mic size={13} />} title="Voice" />
            <Button
              variant={deepSearch ? "primary" : "ghost"}
              size="sm"
              icon={<I.Sparkles size={13} />}
              onClick={() => setDeepSearch((v) => !v)}
              title="Tìm sâu — viết lại truy vấn + chấm điểm tri thức (chậm hơn, chính xác hơn)"
              aria-pressed={deepSearch}
            >
              Tìm sâu
            </Button>
            <Button
              variant={smartRoute ? "primary" : "ghost"}
              size="sm"
              icon={<I.GitBranch size={13} />}
              onClick={() => setSmartRoute((v) => !v)}
              title="Định tuyến — tự chọn nguồn trả lời: tài liệu (KB), dữ liệu bản ghi, web, hoặc trả lời thẳng"
              aria-pressed={smartRoute}
            >
              Định tuyến
            </Button>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<I.Send size={13} />}
            onClick={() => send(input)}
            disabled={!input.trim()}
          >
            {t("agent.send")}
          </Button>
        </div>
      </div>
    </aside>
  );
}

function MessageBubble({
  msg,
  onSuggest,
  canSaveKb,
}: {
  msg: Message;
  onSuggest: (text: string) => void;
  canSaveKb: boolean;
}) {
  const t = useT();
  const isUser = msg.role === "user";
  const [kbState, setKbState] = useState<"" | "saving" | "saved" | "err">("");

  // Chỉ cho lưu câu trả lời thật của trợ lý (có nội dung, không lỗi/pending/tool).
  const canSave =
    canSaveKb && !isUser && !msg.pending && !msg.error && !msg.toolCall && !!msg.content.trim();

  const saveKb = async () => {
    setKbState("saving");
    try {
      const c = msg.content.trim();
      const title = c.replace(/\s+/g, " ").slice(0, 60) || "Ghi chú từ chat";
      await kb.addText(title, c);
      setKbState("saved");
    } catch {
      setKbState("err");
    }
  };

  return (
    <div className={cn("flex gap-2", isUser && "flex-row-reverse")}>
      <span
        className={cn(
          "w-7 h-7 shrink-0 rounded-md flex items-center justify-center",
          isUser ? "bg-accent text-white" : "bg-panel-2 border border-border",
        )}
      >
        {isUser ? <I.User size={13} /> : <I.Sparkles size={13} className="text-accent" />}
      </span>
      <div className="flex-1 min-w-0 max-w-[85%]">
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm wrap-break-word",
            msg.error
              ? "bg-danger/10 border border-danger/30 text-danger"
              : isUser
                ? "bg-accent/20 text-text"
                : "bg-panel-2 border border-border",
          )}
        >
          {msg.pending && !msg.content ? (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <I.Loader size={13} className="animate-spin" /> {t("agent.thinking")}
            </span>
          ) : isUser || msg.error ? (
            // Tin người dùng / lỗi: giữ văn bản thô (không diễn giải markdown).
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : (
            // Câu trả lời chatbot: render Markdown → UI (đậm, bảng, list…).
            <Markdown text={msg.content} />
          )}
        </div>
        {msg.toolCall && (
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <Chip variant="accent" className="font-mono">
              <I.Loader size={10} className="animate-spin" /> {msg.toolCall.name}
            </Chip>
          </div>
        )}
        {canSave && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={saveKb}
              disabled={kbState === "saving" || kbState === "saved"}
              className="text-[11px] px-2 py-0.5 rounded-sm border border-border bg-bg-soft hover:bg-hover/40 inline-flex items-center gap-1 disabled:opacity-60"
            >
              <I.File size={10} />
              {kbState === "saved"
                ? "✓ Đã lưu vào tri thức"
                : kbState === "saving"
                  ? "Đang lưu…"
                  : kbState === "err"
                    ? "Lỗi — thử lại"
                    : "Lưu vào tri thức"}
            </button>
          </div>
        )}
        {msg.suggestions && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {msg.suggestions.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => onSuggest(s)}
                className="text-[11px] px-2 py-0.5 rounded-sm border border-border bg-bg-soft hover:bg-hover/40"
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
