import { createFileRoute } from "@tanstack/react-router";
import { EntityDesigner } from "@/components/designer/EntityDesigner";

function Route_() {
  const { id } = Route.useParams();
  return <EntityDesigner entityId={id} />;
}
export const Route = createFileRoute("/entities/$id")({ component: Route_ });
