import { createFileRoute } from "@tanstack/react-router";
import { EntityDesigner } from "@/components/designer/EntityDesigner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSetAgentContext } from "@/hooks/useSetAgentContext";
import { useUserObjects } from "@/stores/userObjects";

function Route_() {
  const { id } = Route.useParams();
  const name = useUserObjects((s) => s.entities.find((e) => e.id === id)?.name);
  useDocumentTitle(name);
  useSetAgentContext(name ? { type: "entity", id, label: name } : null);
  return <EntityDesigner entityId={id} />;
}
export const Route = createFileRoute("/entities/$id")({ component: Route_ });
