import { createFileRoute } from "@tanstack/react-router";
import { PageDesigner } from "@/components/designer/PageDesigner";

function PageRoute() {
  const { id } = Route.useParams();
  return <PageDesigner pageId={id} />;
}
export const Route = createFileRoute("/pages/$id")({ component: PageRoute });
