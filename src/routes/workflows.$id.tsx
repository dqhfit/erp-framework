import { WorkflowDesigner } from "@/components/designer/WorkflowDesigner";
import { createFileRoute } from "@tanstack/react-router";

function WorkflowRoute() {
  const { id } = Route.useParams();
  return <WorkflowDesigner workflowId={id} />;
}
export const Route = createFileRoute("/workflows/$id")({ component: WorkflowRoute });
