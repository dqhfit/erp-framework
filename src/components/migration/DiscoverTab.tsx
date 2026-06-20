/* DiscoverTab — tab Discover: seed/exclude bảng + JobRunner discover, rồi
   render manifest qua TablesPanel/ProcsPanel/EdgesPanel. Tách từ
   settings.migration.tsx (pilot refactor). */
import { useState } from "react";
import { EdgesPanel } from "@/components/migration/discover/EdgesPanel";
import { ProcsPanel } from "@/components/migration/discover/ProcsPanel";
import { TablesPanel } from "@/components/migration/discover/TablesPanel";
import { JobRunner } from "@/components/migration/JobRunner";
import type {
  ManifestEdge,
  ManifestProcRow,
  ManifestTableRow,
} from "@/components/migration/manifest-types";
import { FormField, TagBox } from "@/components/ui";
import { useT } from "@/hooks/useT";

export function DiscoverTab({
  moduleName,
  summary,
  envOk,
  connTables,
  onChanged,
}: {
  moduleName: string;
  summary: { manifest: unknown; enrichedManifest: unknown } | null;
  envOk: boolean;
  connTables: string[];
  onChanged: () => void;
}) {
  const t = useT();
  const [seed, setSeed] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);

  const manifest = summary?.manifest as
    | {
        tables?: ManifestTableRow[];
        procs?: ManifestProcRow[];
        crossModuleEdges?: ManifestEdge[];
      }
    | undefined;

  return (
    <div className="space-y-4">
      <JobRunner
        moduleName={moduleName}
        action="discover"
        envOk={envOk}
        buildArgs={() => ({ seedTables: seed, excludeTables: exclude })}
        renderForm={() => (
          <>
            <FormField label={t("mig.discover_seed_label", { count: connTables.length })}>
              <TagBox
                value={seed}
                onChange={setSeed}
                suggestions={connTables}
                placeholder={t("mig.ph_seed_bfs")}
              />
            </FormField>
            <FormField label={t("mig.discover_exclude")}>
              <TagBox
                value={exclude}
                onChange={setExclude}
                suggestions={connTables}
                placeholder={t("mig.ph_exclude_table")}
              />
            </FormField>
          </>
        )}
        canRun={() => seed.length > 0}
        onCompleted={onChanged}
      />

      {/* Full manifest preview — không truncate */}
      {manifest && (
        <>
          <TablesPanel tables={manifest.tables ?? []} moduleName={moduleName} />
          <ProcsPanel procs={manifest.procs ?? []} moduleName={moduleName} />
          <EdgesPanel edges={manifest.crossModuleEdges ?? []} />
        </>
      )}
    </div>
  );
}
