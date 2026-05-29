import { createFileRoute } from "@tanstack/react-router";
import { PageDesigner } from "@/components/designer/PageDesigner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUserObjects } from "@/stores/userObjects";

function PageRoute() {
  const { id } = Route.useParams();
  const name = useUserObjects((s) => s.pages.find((p) => p.id === id)?.name);
  useDocumentTitle(name);
  return <PageDesigner pageId={id} />;
}
export const Route = createFileRoute("/pages/$id")({ component: PageRoute });
