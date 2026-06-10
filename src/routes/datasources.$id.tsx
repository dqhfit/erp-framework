import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DataSourceCanvas } from "@/components/designer/DataSourceCanvas";
import { DataSourceCodePanel } from "@/components/designer/DataSourceCodePanel";
import { DataSourceDesigner } from "@/components/designer/DataSourceDesigner";
import { DataSourceSqlPanel } from "@/components/designer/DataSourceSqlPanel";
import { I } from "@/components/Icons";
import { Tabs } from "@/components/ui";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUserObjects } from "@/stores/userObjects";

type DSTab = "config" | "canvas" | "sql" | "code";

/** id sentinel: màn hình SQL độc lập (mở từ menu) — soạn rồi lưu thành / áp dụng
 *  vào nguồn dữ liệu. UUID thật không bao giờ trùng giá trị này. */
const SQL_WORKBENCH = "__sql__";

function Route_() {
  const { id } = Route.useParams();
  const name = useUserObjects((s) => s.dataSources.find((d) => d.id === id)?.name);
  const isWorkbench = id === SQL_WORKBENCH;
  useDocumentTitle(isWorkbench ? "Soạn SQL" : name);
  const [tab, setTab] = useState<DSTab>("config");
  const navigate = useNavigate();

  // Màn hình SQL độc lập: chỉ panel SQL (không tab, không bind 1 NDL cụ thể).
  if (isWorkbench) {
    return (
      <div className="h-full">
        <DataSourceSqlPanel />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Hàng tab + nút đóng cửa sổ (bên phải) — đóng = về trang chủ. */}
      <div className="flex items-stretch shrink-0">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "config", label: "Cấu hình" },
            { value: "canvas", label: "Canvas (ERD)" },
            { value: "sql", label: "SQL" },
            { value: "code", label: "Code & AI" },
          ]}
          className="flex-1 px-4"
        />
        <button
          type="button"
          onClick={() => navigate({ to: "/" })}
          className="shrink-0 flex items-center px-3 border-b border-border text-muted hover:text-text hover:bg-hover/60 transition-colors"
          title="Đóng nguồn dữ liệu"
          aria-label="Đóng nguồn dữ liệu"
        >
          <I.X size={16} />
        </button>
      </div>
      {/* key={id} → đổi nguồn dữ liệu remount panel: SQL/Code đọc lại nội dung
          theo nguồn được chọn (2 panel này chụp state cục bộ lúc mount). */}
      <div key={id} className="flex-1 min-h-0">
        {tab === "config" ? (
          <DataSourceDesigner id={id} />
        ) : tab === "canvas" ? (
          <DataSourceCanvas id={id} />
        ) : tab === "sql" ? (
          <DataSourceSqlPanel id={id} />
        ) : (
          <DataSourceCodePanel id={id} />
        )}
      </div>
    </div>
  );
}
export const Route = createFileRoute("/datasources/$id")({ component: Route_ });
