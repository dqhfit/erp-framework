import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { useMcpClient } from "@/hooks/useMcpClient";
import type {
  AgentDesign,
  EntityDesign,
  PageDesign,
  WorkflowDesign,
} from "@/lib/ai-design-prompts";
import type { MockEntity } from "@/lib/object-types";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";
/* ==========================================================
   GlobalAiCreateDrawer — Drawer toàn cục mở từ Sidebar +.
   Sau khi AI propose config:
     - Sinh id uuid (khớp khoá chính backend)
     - Lưu vào useUserObjects (đẩy lên PostgreSQL)
     - Navigate sang designer tương ứng
   Mount 1 lần ở __root.tsx; điều khiển qua useUI.aiCreateTarget
   ========================================================== */
import { useNavigate } from "@tanstack/react-router";

export function GlobalAiCreateDrawer() {
  const target = useUI((s) => s.aiCreateTarget);
  const setTarget = useUI((s) => s.setAiCreateTarget);
  const navigate = useNavigate();
  const { tools: mcpTools } = useMcpClient();
  const { addEntity, addPage, addWorkflow, addAgent, entities: userEntities } = useUserObjects();

  if (!target) return null;

  const close = () => setTarget(null);

  // === Apply handlers cho 4 type — id uuid khớp backend ===
  const applyEntity = (d: EntityDesign) => {
    const id = crypto.randomUUID();
    addEntity({
      id,
      name: d.name,
      icon: (d.icon as MockEntity["icon"]) ?? "Database",
      mcp: d.mcp ?? "",
      fields: (d.fields ?? []).map((f, i) => ({
        id: `ai_${Date.now()}_${i}`,
        name: f.name,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options,
        ref: f.ref,
        formula: f.formula,
      })),
    });
    close();
    navigate({ to: "/entities/$id", params: { id } });
  };
  const applyPage = (d: PageDesign) => {
    const id = crypto.randomUUID();
    addPage({ id, name: d.name, icon: "Layout", updated: "vừa xong", author: "AI" });
    close();
    navigate({ to: "/pages/$id", params: { id } });
  };
  const applyWorkflow = (d: WorkflowDesign) => {
    const id = crypto.randomUUID();
    addWorkflow({ id, name: d.name, icon: "Workflow", status: "active", runs: 0 });
    close();
    navigate({ to: "/workflows/$id", params: { id } });
  };
  const applyAgent = (d: AgentDesign) => {
    const id = crypto.randomUUID();
    addAgent({
      id,
      name: d.name,
      model: d.model || "claude-sonnet-4-6",
      tools: d.tools?.length ?? 0,
    });
    close();
    navigate({ to: "/agents/$id", params: { id } });
  };

  const ctx = {
    mcpTools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
    otherEntities: userEntities.map((e) => ({
      id: e.id,
      name: e.name,
      mcp: e.mcp,
      fieldKeys: e.fields.map((f) => f.name),
    })),
  };

  if (target === "entity") {
    return (
      <AiAssistDrawer
        open
        onClose={close}
        objectType="entity"
        context={ctx}
        onApply={applyEntity}
      />
    );
  }
  if (target === "page") {
    return (
      <AiAssistDrawer open onClose={close} objectType="page" context={ctx} onApply={applyPage} />
    );
  }
  if (target === "workflow") {
    return (
      <AiAssistDrawer
        open
        onClose={close}
        objectType="workflow"
        context={ctx}
        onApply={applyWorkflow}
      />
    );
  }
  return (
    <AiAssistDrawer open onClose={close} objectType="agent" context={ctx} onApply={applyAgent} />
  );
}
