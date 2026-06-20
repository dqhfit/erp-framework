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
