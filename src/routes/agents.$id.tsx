import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
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

interface AgentState {
  name: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  tools: string[];
  /** Adapter để biết list model nào — dùng đầu model name để đoán nếu chưa có */
  adapter?: string;
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

function AgentRoute() {
  const { id } = Route.useParams();
  const userAgents = useUserObjects((s) => s.agents);
  const fallbackAgent: MockAgent = { id, name: "Agent", model: "claude-sonnet-4-6", tools: 0 };
  const agent = userAgents.find((a) => a.id === id) ?? fallbackAgent;
  const setAgentOpen = useUI((s) => s.setAgentOpen);
  const { tools: mcpTools } = useMcpClient();

  const [state, setState] = useState<AgentState>({
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
  });
  const [aiOpen, setAiOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const setAgentContent = useUserObjects((s) => s.setAgentContent);

  // Load config đã lưu khi đổi agent
  useEffect(() => {
    const stored = useUserObjects.getState().agentContent[id] as AgentState | undefined;
    if (stored) setState(stored);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = () => {
    setAgentContent(id, state);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
      name: design.name ?? state.name,
      model: design.model ?? state.model,
      systemPrompt: design.systemPrompt ?? state.systemPrompt,
      temperature: design.temperature ?? state.temperature,
      tools: design.tools ?? state.tools,
    });
    setAiOpen(false);
  };

  const toggleTool = (t: string) => {
    setState((s) => ({
      ...s,
      tools: s.tools.includes(t) ? s.tools.filter((x) => x !== t) : [...s.tools, t],
    }));
  };

  const availableToolNames = mcpTools.length
    ? mcpTools.map((t) => t.name)
    : DEFAULT_TOOLS;

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-12 h-12 rounded-lg flex items-center justify-center text-white"
                style={{ background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))" }}>
            <I.Bot size={22} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{state.name}</h1>
            <div className="text-xs text-muted font-mono">{state.model} · {state.tools.length} tools</div>
          </div>
          <div className="flex-1" />
          <Button variant="default" icon={<I.Sparkles size={13} />} onClick={() => setAiOpen(true)}>
            AI Assist
          </Button>
          <Button variant="default" icon={<I.Save size={13} />} onClick={save}>
            Lưu
          </Button>
          {saved && (
            <span className="text-xs text-success flex items-center gap-1">
              <I.Check size={11} /> Đã lưu
            </span>
          )}
          <Button variant="primary" icon={<I.Sparkles size={13} />} onClick={() => setAgentOpen(true)}>
            Trò chuyện
          </Button>
        </div>

        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
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
              <FormField label={`Temperature (${state.temperature.toFixed(1)})`}>
                <input
                  type="range" min="0" max="1" step="0.1"
                  value={state.temperature}
                  onChange={(e) => setState({ ...state, temperature: parseFloat(e.target.value) })}
                  className="w-full accent-[hsl(var(--accent))]"
                />
              </FormField>
            </Card>

            <Card>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">System prompt</div>
              <textarea
                className="input font-mono text-xs w-full"
                rows={10}
                value={state.systemPrompt}
                onChange={(e) => setState({ ...state, systemPrompt: e.target.value })}
              />
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Tools ({state.tools.length})
                </div>
                {mcpTools.length === 0 && (
                  <Chip variant="warning" className="text-[10px]">Chưa kết nối MCP — dùng default list</Chip>
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
                      {active ? "v " : ""}{t}
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          <Card>
            <div className="font-semibold mb-2">30 ngày gần đây</div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Conversations</dt><dd>418</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Tool calls</dt><dd>1.122</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Đánh giá</dt><dd>★ 4.7</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Token / msg</dt><dd>1,2k</dd></div>
            </dl>
          </Card>
        </div>

        <div className="mt-4">
          <HeartbeatPanel agentId={id} />
        </div>
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
export const Route = createFileRoute("/agents/$id")({ component: AgentRoute });
