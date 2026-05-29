import { createFileRoute } from "@tanstack/react-router";
import { EntityDesigner } from "@/components/designer/EntityDesigner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUserObjects } from "@/stores/userObjects";

function Route_() {
  const { id } = Route.useParams();
  const name = useUserObjects((s) => s.entities.find((e) => e.id === id)?.name);
  useDocumentTitle(name);
  return <EntityDesigner entityId={id} />;
}
export const Route = createFileRoute("/entities/$id")({ component: Route_ });
