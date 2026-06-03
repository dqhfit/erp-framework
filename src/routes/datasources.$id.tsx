import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DataSourceCanvas } from "@/components/designer/DataSourceCanvas";
import { DataSourceDesigner } from "@/components/designer/DataSourceDesigner";
import { Tabs } from "@/components/ui";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUserObjects } from "@/stores/userObjects";

type DSTab = "config" | "canvas";

function Route_() {
  const { id } = Route.useParams();
  const name = useUserObjects((s) => s.dataSources.find((d) => d.id === id)?.name);
  useDocumentTitle(name);
  const [tab, setTab] = useState<DSTab>("config");

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "config", label: "Cấu hình" },
          { value: "canvas", label: "Canvas (ERD)" },
        ]}
        className="px-4 shrink-0"
      />
      <div className="flex-1 min-h-0">
        {tab === "config" ? <DataSourceDesigner id={id} /> : <DataSourceCanvas id={id} />}
      </div>
    </div>
  );
}
export const Route = createFileRoute("/datasources/$id")({ component: Route_ });
