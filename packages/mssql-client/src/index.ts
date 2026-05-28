/* ==========================================================
   @erp-framework/mssql-client — wrap driver `mssql` + helper
   introspection + heuristic phan tich proc body.

   Dung cho:
     - CLI tooling/migration-cli (discovery, generate, capture-golden, data)
     - Plugin packages/plugins/mssql-bridge (MCP-connector runtime)
   ========================================================== */

export { MssqlClient, type MssqlClientOptions } from "./client.js";
export {
  analyzeProc,
  stripCommentsAndStrings,
  extractAliasMap,
  extractReads,
  extractWrites,
  extractJoinPairs,
  extractExecCalls,
  detectFlags,
  pickTier,
} from "./parse-proc.js";
export type {
  TableInfo,
  ColumnInfo,
  ForeignKey,
  ProcInfo,
  ProcParameter,
  ProcAnalysis,
  JoinPair,
  ProcFlag,
  ProcStats,
} from "./types.js";
