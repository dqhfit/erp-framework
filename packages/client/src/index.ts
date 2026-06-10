/* @erp-framework/client — DataSource + client xác thực + client
   cấu hình cho frontend. App chọn rồi inject vào core/ui. */

export {
  type AgentChatClient,
  createAgentChatClient,
  type SaveExchangeInput,
} from "./agent-chats";
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
  type ClientErrorLevel,
  type ClientErrorSource,
  type ClientErrorStatus,
  createErrorsClient,
  type ErrorDetail,
  type ErrorListItem,
  type ErrorReportInput,
  type ErrorStats,
  type ErrorsClient,
} from "./errors";
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
  type ProposalAction,
  type ProposalDetail,
  type ProposalListItem,
  type ProposalStatus,
  type RoadmapItem,
  type RoadmapStatus,
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
export {
  createLegacyMenuClient,
  type LegacyMenuClient,
  type LegacyMenuNode,
  type LegacyMenuNodeDetail,
  type LegacyMenuResolved,
  type LegacyMenuStats,
  type LegacyReport,
} from "./legacy-menu";
export { LocalStorageDataSource } from "./local-storage";
export {
  createMesMucTieuMigrateClient,
  type MesMucTieuMigrateClient,
  type MigratePreview,
  type MigrateResult,
  type MssqlMonthItem,
  type RelatedForm,
} from "./mes-muctieu-migrate";
export {
  createMesMucTieuSanXuatClient,
  type MesMucTieuSanXuatClient,
  type MucTieuChitietRow,
  type MucTieuThangRow,
} from "./mes-muctieu-sanxuat";
export {
  createMigrationClient,
  type MigrationAction,
  type MigrationAiLogEntry,
  type MigrationClient,
  type MigrationEnvCheck,
  type MigrationJobRow,
  type MigrationJobState,
  type MigrationModuleSummary,
} from "./migration";
export {
  type CutoverCheck,
  createMigrationSyncClient,
  type MigrationSyncClient,
  type SyncModuleRow,
  type SyncTableRow,
} from "./migration-sync";
export {
  createMssqlConnectionsClient,
  type MssqlConnectionSaveInput,
  type MssqlConnectionsClient,
  type MssqlConnectionView,
  type MssqlTestResult,
} from "./mssql-connections";
export { createNavClient, type NavClient, type NavItem, type NavKind } from "./nav";
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
export { createOrgClient, type OrgClient } from "./org";
export {
  createPluginsClient,
  type PluginSaveInput,
  type PluginsClient,
} from "./plugins";
export {
  createPrintTemplatesClient,
  type PrintTemplateSummary,
  type PrintTemplatesClient,
} from "./print-templates";
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
