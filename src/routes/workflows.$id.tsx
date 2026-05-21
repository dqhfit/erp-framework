import { createFileRoute } from "@tanstack/react-router";
import { WorkflowDesigner } from "@/components/designer/WorkflowDesigner";

function WorkflowRoute() {
  const { id } = Route.useParams();
  return <WorkflowDesigner workflowId={id} />;
}
export const Route = createFileRoute("/workflows/$id")({ component: WorkflowRoute });
