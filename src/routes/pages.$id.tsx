import { createFileRoute } from "@tanstack/react-router";
import { PageDesigner } from "@/components/designer/PageDesigner";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { useUI } from "@/stores/ui";

function PageRoute() {
  const { id } = Route.useParams();
  const mode = useUI((s) => s.mode);
  return mode === "consumer" ? <ConsumerPage pageId={id} /> : <PageDesigner pageId={id} />;
}
export const Route = createFileRoute("/pages/$id")({ component: PageRoute });
