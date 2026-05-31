/* @erp-framework/client — DataSource + client xác thực + client
   cấu hình cho frontend. App chọn rồi inject vào core/ui. */

export { ApiDataSource, createApiDataSource } from "./api";
export {
  type ApiKeyCreateResult,
  type ApiKeyListItem,
  type ApiKeysClient,
  createApiKeysClient,
} from "./api-keys";
export {
  type ApprovalCreateInput,
  type ApprovalStatus,
  type ApprovalsClient,
  createApprovalsClient,
} from "./approvals";
export { createAuthClient } from "./auth";
export {
  type BackupClient,
  type BackupConfigView,
  type BackupRun,
  createBackupClient,
} from "./backup";
export {
  type CompaniesClient,
  type CompanyRole,
  createCompaniesClient,
} from "./companies";
export {
  createConfigClient,
  type LlmProfileInput,
  type LlmProfileMineInput,
} from "./config";
export {
  createAgentChatClient,
  type AgentChatClient,
  type SaveExchangeInput,
} from "./agent-chats";
export {
  createEmbedClient,
  type EmbedClient,
  type EmbedScope,
} from "./embed";
export {
  createEntitySyncClient,
  type EntitySyncClient,
  type EntitySyncRunResult,
  type EntitySyncSaveInput,
} from "./entity-sync";
export {
  createEntityWebhooksClient,
  type EntityWebhook,
  type EntityWebhookSaveInput,
  type EntityWebhooksClient,
} from "./entity-webhooks";
export {
  createEnumsClient,
  type EnumAiDraft,
  type EnumSaveInput,
  type EnumsClient,
  type EnumValue,
} from "./enums";
export {
  createFeedbackClient,
  type FeedbackArea,
  type FeedbackClient,
  type FeedbackCommentRow,
  type FeedbackCreateInput,
  type FeedbackDetail,
  type FeedbackListItem,
  type FeedbackSeverity,
  type FeedbackStatus,
  type SimilarHit,
} from "./feedback";
export {
  createHeartbeatsClient,
  type HeartbeatSaveInput,
  type HeartbeatsClient,
} from "./heartbeats";
export {
  createIotClient,
  type IotClient,
  type IotCommandRow,
  type IotDevice,
  type IotTelemetryRow,
} from "./iot";
export {
  createKnowledgeClient,
  type EmbeddingProfileInput,
  type KnowledgeClient,
  type KnowledgeHit,
  type KnowledgeSource,
} from "./knowledge";
export { LocalStorageDataSource } from "./local-storage";
export {
  type AgentMemberRole,
  type AgentMemberRow,
  type AgentSaveInput,
  createObjectsClient,
  type EntityFieldInput,
  type EntitySaveInput,
  type ObjectsClient,
  type PageSaveInput,
  type ScheduleSaveInput,
  type WorkflowSaveInput,
} from "./objects";
export {
  createMigrationClient,
  type MigrationAction,
  type MigrationAiLogEntry,
  type MigrationClient,
  type MigrationEnvCheck,
  type MigrationJobState,
  type MigrationModuleSummary,
} from "./migration";
export {
  createLegacyMenuClient,
  type LegacyMenuClient,
  type LegacyMenuNode,
  type LegacyMenuNodeDetail,
  type LegacyMenuResolved,
  type LegacyMenuStats,
  type LegacyReport,
} from "./legacy-menu";
export {
  createMssqlConnectionsClient,
  type MssqlConnectionSaveInput,
  type MssqlConnectionView,
  type MssqlConnectionsClient,
  type MssqlTestResult,
} from "./mssql-connections";
export { createOrgClient, type OrgClient } from "./org";
export {
  createPluginsClient,
  type PluginSaveInput,
  type PluginsClient,
} from "./plugins";
export {
  createProceduresClient,
  type ProcedureAiDraft,
  type ProcedureInvokeResult,
  type ProcedureSaveInput,
  type ProceduresClient,
} from "./procedures";
export {
  createRecordCommentsClient,
  type RecordComment,
  type RecordCommentsClient,
} from "./record-comments";
export {
  createSavedViewsClient,
  type SavedView,
  type SavedViewSaveInput,
  type SavedViewsClient,
} from "./saved-views";
export {
  createToolsClient,
  type ToolActionDef,
  type ToolInvokeArgs,
  type ToolIODef,
  type ToolKind,
  type ToolListItem,
  type ToolManifestView,
  type ToolRuntime,
  type ToolStatus,
  type ToolsClient,
} from "./tools";
