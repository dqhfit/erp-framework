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
  // key={id} → mỗi trang là instance độc lập: chuyển trang remount, reset
  // sạch state cục bộ (không kế thừa nội dung trang trước).
  return <PageDesigner key={id} pageId={id} />;
}
export const Route = createFileRoute("/pages/$id")({ component: PageRoute });
