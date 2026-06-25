import { createFileRoute } from "@tanstack/react-router";
import { BanVeTypePage } from "@/components/ban-ve/BanVeTypePage";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { useNavTree } from "@/hooks/useNavTree";
import { useUserObjects } from "@/stores/userObjects";

function matchesPage(p: { name?: string; techName?: string }) {
  const tech = (p.techName || "").toLowerCase();
  const label = (p.name || "").toLowerCase();
  return (
    tech.includes("ban_ve_ky_thuat") ||
    tech.includes("ban_ve_kt") ||
    (label.includes("bản vẽ") && label.includes("kỹ thuật"))
  );
}

function BanVeKyThuatRoute() {
  const { page: urlPage } = Route.useSearch();
  const { data: navNodes } = useNavTree();
  const pages = useUserObjects((s) => s.pages);
  const pageContent = useUserObjects((s) => s.pageContent);

  // 1. Ưu tiên 1: Đọc pageId trực tiếp từ URL query param ?page=xxx
  let activePageId = urlPage;

  // 2. Ưu tiên 2: Tìm pageId liên kết trong menu với mã bbiBanVe hoặc I1
  if (!activePageId) {
    const menuNode = navNodes?.find((n) => n.code === "bbiBanVe" || n.code === "I1");
    activePageId = menuNode?.pageId ?? undefined;
  }

  // 3. Ưu tiên 3: Nếu chưa liên kết trong menu, tìm trang khớp thông minh
  if (!activePageId) {
    const fallbackPage = pages.find(matchesPage);
    if (fallbackPage) {
      activePageId = fallbackPage.id ?? undefined;
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

  return <BanVeTypePage phanloai="Bản vẽ kỹ thuật" />;
}

export const Route = createFileRoute("/ban-ve/ky-thuat")({
  validateSearch: (search: Record<string, unknown>): { page?: string } => {
    return {
      page: (search.page as string) || undefined,
    };
  },
  component: BanVeKyThuatRoute,
});
