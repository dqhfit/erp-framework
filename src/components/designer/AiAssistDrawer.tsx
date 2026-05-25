import { I } from "@/components/Icons";
import { Button, Card, Chip, Select } from "@/components/ui";
import { designWithAi, listLlmProfileNames } from "@/core/ai-design";
import { useT } from "@/hooks/useT";
import type { DesignByType, DesignContext, DesignObjectType } from "@/lib/ai-design-prompts";
import { cn } from "@/lib/utils";
import { useSettings } from "@/stores/settings";
/* ==========================================================
   AiAssistDrawer — Drawer phải 400px gọi LLM đề xuất config
   cho 4 loại designer (entity/page/workflow/agent).
   - Chat-style: user prompt + AI proposal
   - Mỗi proposal có nút "Áp dụng" → onApply(data)
   - Picker LLM profile + temperature
   - Hiển thị token usage
   ========================================================== */
import { useEffect, useRef, useState } from "react";

interface Props<T extends DesignObjectType> {
  open: boolean;
  onClose: () => void;
  objectType: T;
  /** Cấu hình hiện tại (cho refine) — undefined nếu tạo mới */
  current?: unknown;
  /** Context gửi cho LLM */
  context?: DesignContext;
  /** Khi user bấm "Áp dụng" trên 1 proposal */
  onApply: (data: DesignByType<T>) => void;
}

interface ChatMessage<T> {
  id: string;
  role: "user" | "ai" | "error";
  text: string;
  data?: T; // gắn với AI message
  usage?: { input_tokens: number; output_tokens: number };
}

const TYPE_LABEL: Record<DesignObjectType, string> = {
  entity: "Entity",
  page: "Page",
  workflow: "Workflow",
  agent: "Agent",
};

export function AiAssistDrawer<T extends DesignObjectType>({
  open,
  onClose,
  objectType,
  current,
  context,
  onApply,
}: Props<T>) {
  const t = useT();
  const [profile, setProfile] = useState<string>("");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Array<ChatMessage<DesignByType<T>>>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const llmProfiles = useSettings((s) => s.llmProfiles);
  const activeModel = profile ? llmProfiles[profile]?.model : undefined;

  // Refresh profile list mỗi lần mở drawer (user có thể vừa thêm profile)
  useEffect(() => {
    if (!open) return;
    const list = listLlmProfileNames();
    setProfiles(list);
    if (list.length && !list.includes(profile)) {
      setProfile(list[0] ?? "");
    }
  }, [open, profile]);

  // Auto scroll cuối
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [messages.length, busy]);

  const send = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setPrompt("");
    const userMsg: ChatMessage<DesignByType<T>> = {
      id: `u_${Date.now()}`,
      role: "user",
      text,
    };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);

    // Refine khi đã có proposal mới nhất → dùng nó làm current
    const lastAi = [...messages].reverse().find((m) => m.role === "ai" && m.data);
    const effectiveCurrent = lastAi?.data ?? current;

    try {
      const res = await designWithAi(
        objectType,
        { prompt: text, current: effectiveCurrent },
        context ?? {},
        { profileName: profile || undefined },
      );
      setMessages((m) => [
        ...m,
        {
          id: `a_${Date.now()}`,
          role: "ai",
          text: summarize(objectType, res.data),
          data: res.data,
          usage: res.usage,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `e_${Date.now()}`,
          role: "error",
          text: (e as Error).message,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
      />
      {/* Drawer */}
      <aside
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-[420px] bg-panel border-l border-border shadow-2xl flex flex-col",
          "transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="h-12 shrink-0 px-3 flex items-center gap-2 border-b border-border">
          <span
            className="w-7 h-7 rounded-md flex items-center justify-center text-white"
            style={{
              background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
            }}
          >
            <I.Sparkles size={14} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{t("ai.title")}</div>
            <div className="text-[11px] text-muted truncate">
              {TYPE_LABEL[objectType]} · {current ? t("ai.refine") : t("ai.new")}
              {activeModel && (
                <>
                  {" "}
                  · <span className="font-mono">{activeModel}</span>
                </>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<I.Trash size={12} />}
            onClick={() => setMessages([])}
            title={t("ai.clear_history")}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<I.ChevronRight size={14} />}
            onClick={onClose}
            title={t("common.close")}
          />
        </div>

        {/* Profile picker */}
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <span className="text-[11px] text-muted shrink-0">{t("ai.profile")}</span>
          {profiles.length ? (
            <>
              <Select
                className="h-7 text-xs flex-1 min-w-0"
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
              >
                {Object.entries(
                  profiles.reduce<Record<string, string[]>>((acc, p) => {
                    const ad = llmProfiles[p]?.adapter ?? "khác";
                    (acc[ad] = acc[ad] ?? []).push(p);
                    return acc;
                  }, {}),
                ).map(([ad, names]) => (
                  <optgroup key={ad} label={ad}>
                    {names.map((p) => {
                      const m = llmProfiles[p]?.model;
                      return (
                        <option key={p} value={p}>
                          {m ? `${p} — ${m}` : p}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </Select>
              {activeModel && (
                <Chip className="text-[10px] font-mono shrink-0" title="Model đang dùng">
                  {activeModel}
                </Chip>
              )}
            </>
          ) : (
            <Chip variant="warning" className="text-[11px]">
              {t("ai.no_llm_profile")}
            </Chip>
          )}
        </div>

        {/* Chat history */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
          {messages.length === 0 && (
            <div className="text-xs text-muted text-center py-8 px-2 whitespace-pre-line">
              {t("ai.empty_hint", { kind: TYPE_LABEL[objectType] })}
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              onApply={() => m.data && onApply(m.data as DesignByType<T>)}
            />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <I.Loader size={12} className="animate-spin" /> {t("ai.thinking")}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-border bg-bg-soft/30">
          <textarea
            className="input font-mono text-sm w-full"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t(`ai.placeholder_${objectType}`)}
            disabled={busy}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-muted">{t("ai.send_hint")}</span>
            <Button
              variant="primary"
              size="sm"
              icon={
                busy ? <I.Loader size={12} className="animate-spin" /> : <I.Sparkles size={12} />
              }
              onClick={send}
              disabled={busy || !prompt.trim() || !profiles.length}
            >
              {messages.find((m) => m.role === "ai") ? t("ai.btn_refine") : t("ai.btn_propose")}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ============= Bubble + summary =============

function MessageBubble<T>({ msg, onApply }: { msg: ChatMessage<T>; onApply: () => void }) {
  const t = useT();
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] bg-accent/10 border border-accent/30 text-text rounded-md px-2.5 py-2 text-sm whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    );
  }
  if (msg.role === "error") {
    return (
      <Card className="p-2.5 bg-danger/10 border-danger/30">
        <div className="text-xs text-danger font-medium mb-1">{t("ai.error_label")}</div>
        <div className="text-xs text-danger whitespace-pre-wrap break-all">{msg.text}</div>
      </Card>
    );
  }
  return (
    <Card className="p-2.5">
      <div className="text-xs text-muted mb-1.5 flex items-center gap-2">
        <I.Sparkles size={11} className="text-accent" /> {t("ai.proposal_label")}
        {msg.usage && (
          <span className="ml-auto text-[10px] font-mono">
            {msg.usage.input_tokens}↓ {msg.usage.output_tokens}↑
          </span>
        )}
      </div>
      <pre className="text-[11px] font-mono leading-relaxed bg-bg-soft/50 rounded p-2 max-h-60 overflow-auto whitespace-pre-wrap">
        {msg.text}
      </pre>
      <div className="mt-2 flex gap-2">
        <Button variant="primary" size="sm" icon={<I.Check size={11} />} onClick={onApply}>
          {t("ai.btn_apply")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<I.Copy size={11} />}
          onClick={() => navigator.clipboard?.writeText(JSON.stringify(msg.data, null, 2))}
        >
          {t("ai.btn_copy_json")}
        </Button>
      </div>
    </Card>
  );
}

/** Tóm tắt config cho hiển thị trong chat (ngắn gọn, không phải toàn bộ JSON) */
function summarize(type: DesignObjectType, data: unknown): string {
  const d = data as Record<string, unknown>;
  if (type === "entity") {
    const fields =
      (d.fields as Array<{ name?: string; label?: string; type?: string; required?: boolean }>) ??
      [];
    return [
      `📦 ${d.name}${d.mcp ? `  (MCP: ${d.mcp})` : ""}`,
      `${fields.length} field:`,
      ...fields.map((f) => `  • ${f.name}: ${f.label} (${f.type})${f.required ? " *" : ""}`),
    ].join("\n");
  }
  if (type === "page") {
    const comps =
      (d.components as Array<{ type?: string; title?: string; w?: number; h?: number }>) ?? [];
    return [
      `📄 ${d.name}`,
      `${comps.length} component:`,
      ...comps.map((c) => `  • ${c.type} — "${c.title}" (${c.w}×${c.h})`),
    ].join("\n");
  }
  if (type === "workflow") {
    const nodes = (d.nodes as Array<{ id?: string; type?: string; label?: string }>) ?? [];
    const edges = (d.edges as Array<{ source?: string; target?: string }>) ?? [];
    return [
      `🔄 ${d.name}`,
      `${nodes.length} node, ${edges.length} edge:`,
      ...nodes.map((n) => `  • [${n.type}] ${n.label}`),
    ].join("\n");
  }
  if (type === "agent") {
    const tools = (d.tools as string[]) ?? [];
    return [
      `🤖 ${d.name} — ${d.model}`,
      `System: ${String(d.systemPrompt).slice(0, 120)}${String(d.systemPrompt).length > 120 ? "..." : ""}`,
      `Tools (${tools.length}): ${tools.slice(0, 4).join(", ")}${tools.length > 4 ? "..." : ""}`,
    ].join("\n");
  }
  return JSON.stringify(data, null, 2).slice(0, 500);
}
