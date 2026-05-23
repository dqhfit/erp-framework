import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { I } from "@/components/Icons";
import type { MockAgent } from "@/lib/object-types";
import { useUserObjects } from "@/stores/userObjects";
import { Button, Chip, Card, FormField, Input, Select } from "@/components/ui";
import { useUI } from "@/stores/ui";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { HeartbeatPanel } from "@/components/HeartbeatPanel";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useDynamicModels } from "@/hooks/useDynamicModels";
import type { AgentDesign } from "@/lib/ai-design-prompts";
import { createObjectsClient } from "@erp-framework/client";

// 7 file memory chuẩn giống paperclip/openclaw — agent đọc thành
// preamble system prompt, có thể tự ghi nhớ qua tool memory_remember.
const MEMORY_FILES = [
  "IDENTITY", "SOUL", "USER", "TOOLS", "AGENTS", "HEARTBEAT", "BOOTSTRAP",
] as const;
type MemoryFile = typeof MEMORY_FILES[number];
const MEMORY_LABEL: Record<MemoryFile, string> = {
  IDENTITY: "Danh tính", SOUL: "Tinh thần / Giá trị", USER: "Người dùng",
  TOOLS: "Công cụ", AGENTS: "Các agent khác", HEARTBEAT: "Nhịp đập",
  BOOTSTRAP: "Khởi động",
};
const emptyMemory = (): Record<MemoryFile, string> =>
  Object.fromEntries(MEMORY_FILES.map((f) => [f, ""])) as Record<MemoryFile, string>;

interface AgentState {
  name: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  tools: string[];
  /** Adapter để biết list model nào — dùng đầu model name để đoán nếu chưa có */
  adapter?: string;
  /** Memory files persona — server nạp vào system preamble + tool ghi nhớ. */
  memory: Record<MemoryFile, string>;
}

function inferAdapterFromModel(model: string | undefined | null): string {
  // Guard — agent mới tạo có thể chưa có model; tránh crash startsWith.
  if (!model) return "claude";
  if (model.startsWith("claude-")) return "claude";
  if (model.startsWith("gpt-") || /^o[1-9]/.test(model)) return "openai";
  if (model.startsWith("gemini-")) return "gemini";
  return "claude";
}

const DEFAULT_TOOLS = [
  "crm.customer.list",
  "crm.customer.get",
  "sales.order.list",
  "sales.order.create",
  "inv.product.list",
  "analytics.aggregate",
  "notif.email.send",
  "calendar.book",
];

type TabKey = "config" | "memory" | "heartbeat";

function AgentRoute() {
  const { id } = Route.useParams();
  const userAgents = useUserObjects((s) => s.agents);
  const fallbackAgent: MockAgent = { id, name: "Agent", model: "claude-sonnet-4-6", tools: 0 };
  const agent = userAgents.find((a) => a.id === id) ?? fallbackAgent;
  const setAgentOpen = useUI((s) => s.setAgentOpen);
  const { tools: mcpTools } = useMcpClient();

  const initialState: AgentState = {
    name: agent.name,
    // Fallback nếu agent backend không có model — agent mới tạo, hydrate
    // race v.v. — tránh propagate undefined xuống useDynamicModels.
    model: agent.model || "claude-sonnet-4-6",
    systemPrompt:
      "Bạn là trợ lý " + agent.name.toLowerCase() + " cho công ty.\n" +
      "Quy tắc:\n" +
      "- Trả lời tiếng Việt, ngắn gọn, thân thiện.\n" +
      "- Trước khi tạo / sửa dữ liệu, hãy xác nhận lại với người dùng.\n" +
      "- Dùng các tool MCP có sẵn để truy vấn dữ liệu thật.",
    temperature: 0.7,
    tools: DEFAULT_TOOLS.slice(0, agent.tools),
    memory: emptyMemory(),
  };
  const [state, setState] = useState<AgentState>(initialState);
  const [lastSaved, setLastSaved] = useState<AgentState>(initialState);
  const [templates, setTemplates] = useState<Record<MemoryFile, string> | null>(null);
  const api = useMemo(() => createObjectsClient(""), []);
  const [aiOpen, setAiOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const setAgentContent = useUserObjects((s) => s.setAgentContent);

  const [tab, setTab] = useState<TabKey>("config");
  const [activeMem, setActiveMem] = useState<MemoryFile>("IDENTITY");

  // Load config đã lưu khi đổi agent
  useEffect(() => {
    const stored = useUserObjects.getState().agentContent[id] as
      Partial<AgentState> | undefined;
    if (stored) {
      // Agent cũ chưa có memory → điền key trống cho UI không crash.
      const next: AgentState = {
        ...(stored as AgentState),
        memory: { ...emptyMemory(), ...(stored.memory ?? {}) },
      };
      setState(next);
      setLastSaved(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Lấy 7 template mặc định (server đã chèn tên agent vào).
  useEffect(() => {
    api.agents.memoryTemplates(id)
      .then((t) => setTemplates(t as Record<MemoryFile, string>))
      .catch(() => { /* chưa đăng nhập / agent chưa có ở backend */ });
  }, [id, api]);

  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(lastSaved),
    [state, lastSaved],
  );

  const save = () => {
    setAgentContent(id, state);
    setLastSaved(state);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, id]);

  // Dynamic model list theo adapter suy ra từ model hiện tại
  const adapter = state.adapter ?? inferAdapterFromModel(state.model);
  const { models: availableModels, loading: modelsLoading, refresh: refreshModels, source: modelsSource } =
    useDynamicModels(adapter);

  const handleAiApply = (design: AgentDesign) => {
    setState({
      ...state,  // giữ memory + adapter
      name: design.name ?? state.name,
      model: design.model ?? state.model,
      systemPrompt: design.systemPrompt ?? state.systemPrompt,
      temperature: design.temperature ?? state.temperature,
      tools: design.tools ?? state.tools,
    });
    setAiOpen(false);
  };

  const setMemory = (file: MemoryFile, content: string) =>
    setState((s) => ({ ...s, memory: { ...s.memory, [file]: content } }));
  const restoreDefault = (file: MemoryFile) => {
    if (!templates) return;
    setMemory(file, templates[file]);
  };
  const isMemoryEdited = (f: MemoryFile): boolean => {
    const v = state.memory[f] ?? "";
    return v.trim().length > 0 && v !== (templates?.[f] ?? "");
  };
  const editedCount = MEMORY_FILES.filter(isMemoryEdited).length;

  const toggleTool = (t: string) => {
    setState((s) => ({
      ...s,
      tools: s.tools.includes(t) ? s.tools.filter((x) => x !== t) : [...s.tools, t],
    }));
  };

  const availableToolNames = mcpTools.length
    ? mcpTools.map((t) => t.name)
    : DEFAULT_TOOLS;

  /* === Tab content panes — render inline để giữ state cùng cha === */
  const ConfigPane = (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <FormField label="Tên agent">
            <Input value={state.name}
              onChange={(e) => setState({ ...state, name: e.target.value })} />
          </FormField>
          <FormField
            label={
              <span className="flex items-center gap-1.5">
                Model
                {modelsSource && (
                  <span className={`text-[10px] font-normal ${
                    modelsSource === "api" ? "text-success" :
                    modelsSource === "cache" ? "text-muted" : "text-warning"
                  }`}>· {modelsSource}</span>
                )}
              </span>
            }
            hint={`Adapter: ${adapter}`}
          >
            <div className="flex gap-1">
              <Select value={state.model}
                onChange={(e) => setState({ ...state, model: e.target.value })}
                disabled={modelsLoading && availableModels.length === 0}>
                {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                {!availableModels.includes(state.model) && state.model && (
                  <option value={state.model}>{state.model} (custom)</option>
                )}
              </Select>
              <Button variant="ghost" size="sm"
                icon={modelsLoading
                  ? <I.Loader size={12} className="animate-spin" />
                  : <I.Redo size={12} />}
                onClick={() => refreshModels()} title="Refresh list" disabled={modelsLoading} />
            </div>
          </FormField>
        </div>
        <FormField label={`Temperature (${state.temperature.toFixed(1)})`}
          hint="Thấp = nhất quán, ổn định. Cao = sáng tạo, đa dạng.">
          <input
            type="range" min="0" max="1" step="0.1"
            value={state.temperature}
            onChange={(e) => setState({ ...state, temperature: parseFloat(e.target.value) })}
            className="w-full accent-[hsl(var(--accent))]"
          />
        </FormField>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            System prompt
          </div>
          <div className="flex-1" />
          <span className="text-xs text-muted">
            Sẽ ghép sau preamble 7 file memory khi agent chạy.
          </span>
        </div>
        <textarea
          className="input font-mono text-xs w-full"
          rows={8}
          value={state.systemPrompt}
          onChange={(e) => setState({ ...state, systemPrompt: e.target.value })}
        />
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            Tools ({state.tools.length}/{availableToolNames.length})
          </div>
          {mcpTools.length === 0 && (
            <Chip variant="warning" className="!text-[10px]">
              Chưa kết nối MCP — dùng default list
            </Chip>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {availableToolNames.map((t) => {
            const active = state.tools.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTool(t)}
                className={"chip " + (active ? "chip-accent" : "") + " font-mono cursor-pointer"}
              >
                {active ? "✓ " : ""}{t}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );

  const MemoryPane = (
    <div className="grid grid-cols-[220px_1fr] gap-4">
      {/* Sidebar — danh sách file */}
      <Card className="!p-2 self-start">
        <div className="text-[10px] uppercase tracking-wider text-muted px-2 py-1.5">
          7 file memory
        </div>
        <div className="space-y-0.5">
          {MEMORY_FILES.map((f) => {
            const edited = isMemoryEdited(f);
            const active = activeMem === f;
            return (
              <button key={f} type="button"
                onClick={() => setActiveMem(f)}
                className={
                  "w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors "
                  + (active
                    ? "bg-accent/15 text-accent"
                    : "hover:bg-hover/40 text-text")
                }
              >
                <span className="font-mono shrink-0">{f}</span>
                <span className="text-muted truncate">— {MEMORY_LABEL[f]}</span>
                {edited && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                    title="Đã chỉnh sửa so với mặc định" />
                )}
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-muted px-2 pt-2 mt-2 border-t border-border">
          Server nạp 7 file vào system prompt mỗi lần agent chạy. Agent có
          thể tự gọi <code>memory_remember</code> để append nội dung mới.
        </div>
      </Card>

      {/* Editor */}
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-sm">{activeMem}.md</span>
          <span className="text-xs text-muted">— {MEMORY_LABEL[activeMem]}</span>
          {isMemoryEdited(activeMem) && (
            <Chip variant="accent" className="!text-[10px]">Đã sửa</Chip>
          )}
          <div className="flex-1" />
          {templates && (
            <Button size="sm" variant="ghost" icon={<I.Undo size={12} />}
              onClick={() => restoreDefault(activeMem)}>
              Khôi phục mặc định
            </Button>
          )}
        </div>
        <textarea
          className="input font-mono text-xs w-full"
          rows={20}
          placeholder={templates?.[activeMem] ?? "Để trống → server dùng template mặc định."}
          value={state.memory[activeMem] ?? ""}
          onChange={(e) => setMemory(activeMem, e.target.value)}
        />
        <div className="text-[11px] text-muted mt-2">
          {(state.memory[activeMem] ?? "").length} ký tự
          {(state.memory[activeMem] ?? "").trim() === ""
            && " · đang trống → server dùng template mặc định"}
        </div>
      </Card>
    </div>
  );

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1000px] mx-auto p-8">
        {/* === Header === */}
        <div className="flex items-center gap-3 mb-4">
          <span className="w-12 h-12 rounded-lg flex items-center justify-center text-white shrink-0"
                style={{ background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))" }}>
            <I.Bot size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate">{state.name}</h1>
            <div className="text-xs text-muted font-mono truncate">
              {state.model} · {state.tools.length} tools
              {editedCount > 0 && ` · ${editedCount}/7 memory đã sửa`}
            </div>
          </div>
          <div className="flex-1" />
          <Button variant="default" size="sm" icon={<I.Sparkles size={13} />}
            onClick={() => setAiOpen(true)}>
            AI Assist
          </Button>
          <Button
            variant={dirty ? "primary" : "default"} size="sm"
            icon={<I.Save size={13} />} onClick={save} disabled={!dirty && !savedFlash}>
            {savedFlash ? "✓ Đã lưu" : dirty ? "Lưu thay đổi" : "Đã lưu"}
          </Button>
          <Button variant="primary" size="sm" icon={<I.Sparkles size={13} />}
            onClick={() => setAgentOpen(true)}>
            Trò chuyện
          </Button>
        </div>

        {/* === Tabs === */}
        <div className="flex items-center gap-1 mb-4 border-b border-border">
          <TabBtn active={tab === "config"} onClick={() => setTab("config")}
            icon={<I.Settings size={13} />}>Cấu hình</TabBtn>
          <TabBtn active={tab === "memory"} onClick={() => setTab("memory")}
            icon={<I.Bot size={13} />}>
            Bộ nhớ
            {editedCount > 0 && (
              <Chip variant="accent" className="!h-[16px] !text-[10px] ml-1">{editedCount}</Chip>
            )}
          </TabBtn>
          <TabBtn active={tab === "heartbeat"} onClick={() => setTab("heartbeat")}
            icon={<I.Clock size={13} />}>Nhịp đập</TabBtn>
        </div>

        {/* === Tab content === */}
        {tab === "config" && ConfigPane}
        {tab === "memory" && MemoryPane}
        {tab === "heartbeat" && <HeartbeatPanel agentId={id} />}
      </div>

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        objectType="agent"
        current={state}
        context={{
          mcpTools: mcpTools.map((mt) => ({ name: mt.name, description: mt.description })),
        }}
        onApply={handleAiApply}
      />
    </div>
  );
}

/* === Tab button — inline để khỏi thêm UI primitive === */
function TabBtn({ active, onClick, icon, children }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick}
      className={
        "px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px transition-colors "
        + (active
          ? "border-accent text-accent"
          : "border-transparent text-muted hover:text-text")
      }
    >
      {icon}
      {children}
    </button>
  );
}

export const Route = createFileRoute("/agents/$id")({ component: AgentRoute });
