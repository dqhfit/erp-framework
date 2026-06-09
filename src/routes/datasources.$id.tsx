import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DataSourceCanvas } from "@/components/designer/DataSourceCanvas";
import { DataSourceCodePanel } from "@/components/designer/DataSourceCodePanel";
import { DataSourceDesigner } from "@/components/designer/DataSourceDesigner";
import { DataSourceSqlPanel } from "@/components/designer/DataSourceSqlPanel";
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
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "config", label: "Cấu hình" },
          { value: "canvas", label: "Canvas (ERD)" },
          { value: "sql", label: "SQL" },
          { value: "code", label: "Code & AI" },
        ]}
        className="px-4 shrink-0"
      />
      <div className="flex-1 min-h-0">
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
