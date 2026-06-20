/* Type dùng chung cho manifest migration (table/proc/edge + split-enum).
   Dùng bởi nhiều tab trong settings.migration (Discover/Enrich/Generate…). */

export interface SplitEnumRule {
  discriminatorColumn: string;
  discriminatorValue: string;
  name: string;
  label: string;
  description?: string;
  valueColumn?: string;
  labelColumn?: string;
  extraColumns?: string[];
}

export interface ManifestTableRow {
  name: string;
  suggestedEntityName?: string;
  suggestedKind?: "entity" | "enum";
  enumOptions?: string[];
  label?: string;
  description?: string;
  primaryKey?: string[];
  columns?: Array<{
    name: string;
    type: string;
    isNullable?: boolean;
    mapTo?: { field?: string; entityType?: string; label?: string };
  }>;
  inferredRelations?: Array<{
    column: string;
    refTable: string;
    refColumn: string;
    sourceProc?: string;
  }>;
  splitEnums?: SplitEnumRule[];
}

export interface ManifestProcRow {
  name: string;
  suggestedTier?: string;
  targetProcName?: string;
  targetFile?: string;
  label?: string;
  description?: string;
  reads?: string[];
  writes?: string[];
  flags?: string[];
  callsProcs?: string[];
}

export interface ManifestEdge {
  proc: string;
  externalTable: string;
  kind: "read" | "write";
  suggestedContract?: string;
}

/** Trạng thái review module — dùng chung GenerateTab + ReviewTab. */
export interface ReviewStatus {
  module: string;
  phase: string;
  tables: Array<{
    name: string;
    entityName?: string;
    kind: "entity" | "enum";
    label?: string;
    enriched: boolean;
    enumMaterialized: boolean;
    enumId: string | null;
  }>;
  procs: Array<{
    name: string;
    targetProcName?: string;
    targetFile?: string;
    tier: string;
    label?: string;
    enriched: boolean;
    codegenApplied: boolean;
    codegenTarget: string | null;
    goldenCaptured: boolean;
  }>;
  stats: {
    tables: { total: number; enriched: number; enumTotal: number; enumMaterialized: number };
    procs: {
      total: number;
      enriched: number;
      codegenApplied: number;
      goldenCaptured: number;
      tierC: number;
    };
  };
}
