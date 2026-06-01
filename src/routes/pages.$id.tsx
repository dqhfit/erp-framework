import { createFileRoute } from "@tanstack/react-router";
import { PageDesigner } from "@/components/designer/PageDesigner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSetAgentContext } from "@/hooks/useSetAgentContext";
import { useUserObjects } from "@/stores/userObjects";

function PageRoute() {
  const { id } = Route.useParams();
  const name = useUserObjects((s) => s.pages.find((p) => p.id === id)?.name);
  useDocumentTitle(name);
  useSetAgentContext(name ? { type: "page", id, label: name } : null);
  return <PageDesigner pageId={id} />;
}
export const Route = createFileRoute("/pages/$id")({ component: PageRoute });
