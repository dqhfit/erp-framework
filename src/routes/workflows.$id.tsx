import { createFileRoute } from "@tanstack/react-router";
import { WorkflowDesigner } from "@/components/designer/WorkflowDesigner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSetAgentContext } from "@/hooks/useSetAgentContext";
import { useUserObjects } from "@/stores/userObjects";

function WorkflowRoute() {
  const { id } = Route.useParams();
  const name = useUserObjects((s) => s.workflows.find((w) => w.id === id)?.name);
  useDocumentTitle(name);
  useSetAgentContext(name ? { type: "workflow", id, label: name } : null);
  // key={id} → mỗi workflow là một instance độc lập: chuyển workflow sẽ
  // remount, reset sạch state cục bộ + chạy flush autosave khi unmount.
  return <WorkflowDesigner key={id} workflowId={id} />;
}
export const Route = createFileRoute("/workflows/$id")({ component: WorkflowRoute });
