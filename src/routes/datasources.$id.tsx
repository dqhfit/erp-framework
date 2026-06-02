import { createFileRoute } from "@tanstack/react-router";
import { DataSourceDesigner } from "@/components/designer/DataSourceDesigner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUserObjects } from "@/stores/userObjects";

function Route_() {
  const { id } = Route.useParams();
  const name = useUserObjects((s) => s.dataSources.find((d) => d.id === id)?.name);
  useDocumentTitle(name);
  return <DataSourceDesigner id={id} />;
}
export const Route = createFileRoute("/datasources/$id")({ component: Route_ });
