import { createFileRoute } from "@tanstack/react-router";
import { EntityDesigner } from "@/components/designer/EntityDesigner";
import { EntityData } from "@/components/renderer/EntityData";
import { useUI } from "@/stores/ui";

/* mode "consumer" → màn hình dữ liệu (xem/thêm record);
   mode "designer" → trình thiết kế schema. Khớp mẫu pages/$id. */
function Route_() {
  const { id } = Route.useParams();
  const mode = useUI((s) => s.mode);
  return mode === "consumer"
    ? <EntityData entityId={id} />
    : <EntityDesigner entityId={id} />;
}
export const Route = createFileRoute("/entities/$id")({ component: Route_ });
