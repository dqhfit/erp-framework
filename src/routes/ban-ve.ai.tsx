import { createFileRoute } from "@tanstack/react-router";
import { BanVeTypePage } from "@/components/ban-ve/BanVeTypePage";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { useNavTree } from "@/hooks/useNavTree";
import { useUserObjects } from "@/stores/userObjects";

function BanVeAiRoute() {
  const { page: urlPage } = Route.useSearch();
  const { data: navNodes } = useNavTree();
  const pageContent = useUserObjects((s) => s.pageContent);

  // 1. Ưu tiên 1: Đọc pageId trực tiếp từ URL query param ?page=xxx
  let activePageId = urlPage;

  // 2. Ưu tiên 2: Tìm pageId liên kết trong menu với mã bbiBanVeAI hoặc I1217 hoặc I1013
  if (!activePageId) {
    const menuNode = navNodes?.find(
      (n) => n.code === "bbiBanVeAI" || n.code === "I1217" || n.code === "I1013",
    );
    activePageId = menuNode?.pageId ?? undefined;
  }

  // Kiểm tra trang có components thiết kế thực tế không (nếu là trang rỗng thì hiển thị fallback bản vẽ mặc định)
  const content = activePageId
    ? (pageContent[activePageId] as Record<string, unknown> | undefined)
    : null;
  const hasComponents = Array.isArray(content?.components) && content.components.length > 0;

  if (activePageId && hasComponents) {
    return (
      <div className="h-screen overflow-hidden flex flex-col bg-bg text-text">
        <ConsumerPage pageId={activePageId} />
      </div>
    );
  }

  return <BanVeTypePage phanloai="Bản vẽ AI" />;
}

export const Route = createFileRoute("/ban-ve/ai")({
  validateSearch: (search: Record<string, unknown>): { page?: string } => {
    return {
      page: (search.page as string) || undefined,
    };
  },
  component: BanVeAiRoute,
});
