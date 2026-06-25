import { createFileRoute } from "@tanstack/react-router";
import { BanVeTypePage } from "@/components/ban-ve/BanVeTypePage";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { useNavTree } from "@/hooks/useNavTree";
import { useUserObjects } from "@/stores/userObjects";

function BanVeDongGoiRoute() {
  const { page: urlPage } = Route.useSearch();
  const { data: navNodes } = useNavTree();
  const pages = useUserObjects((s) => s.pages);
  const pageContent = useUserObjects((s) => s.pageContent);

  // 1. Ưu tiên 1: Đọc pageId trực tiếp từ URL query param ?page=xxx
  let activePageId = urlPage;

  // 2. Ưu tiên 2: Tìm pageId liên kết trong menu với mã bbiBanVeDongGoi hoặc D1
  if (!activePageId) {
    const menuNode = navNodes?.find((n) => n.code === "bbiBanVeDongGoi" || n.code === "D1");
    activePageId = menuNode?.pageId;
  }

  // 3. Ưu tiên 3: Tìm trang có techName bắt đầu bằng ban_ve_dong_goi_ hoặc name khớp
  if (!activePageId) {
    const fallbackPage = pages.find(
      (p) => p.techName?.startsWith("ban_ve_dong_goi_") || p.name === "Bản vẽ đóng gói",
    );
    if (fallbackPage) {
      activePageId = fallbackPage.id;
    }
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

  return <BanVeTypePage phanloai="Bản vẽ đóng gói" />;
}

export const Route = createFileRoute("/ban-ve/dong-goi")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      page: (search.page as string) || undefined,
    };
  },
  component: BanVeDongGoiRoute,
});
