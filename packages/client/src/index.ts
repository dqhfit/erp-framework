/* @erp-framework/client — DataSource + client xác thực + client
   cấu hình cho frontend. App chọn rồi inject vào core/ui. */
export { LocalStorageDataSource } from "./local-storage";
export { ApiDataSource, createApiDataSource } from "./api";
export { createAuthClient } from "./auth";
export {
  createCompaniesClient,
  type CompaniesClient,
  type CompanyRole,
} from "./companies";
export {
  createHeartbeatsClient,
  type HeartbeatsClient,
  type HeartbeatSaveInput,
} from "./heartbeats";
export {
  createEntitySyncClient,
  type EntitySyncClient,
  type EntitySyncSaveInput,
  type EntitySyncRunResult,
} from "./entity-sync";
export {
  createApprovalsClient,
  type ApprovalsClient,
  type ApprovalStatus,
  type ApprovalCreateInput,
} from "./approvals";
export { createOrgClient, type OrgClient } from "./org";
export {
  createPluginsClient,
  type PluginsClient,
  type PluginSaveInput,
} from "./plugins";
export {
  createToolsClient,
  type ToolsClient,
  type ToolKind,
  type ToolRuntime,
  type ToolStatus,
  type ToolListItem,
  type ToolManifestView,
  type ToolActionDef,
  type ToolIODef,
  type ToolInvokeArgs,
} from "./tools";
export {
  createFeedbackClient,
  type FeedbackClient,
  type FeedbackArea,
  type FeedbackStatus,
  type FeedbackSeverity,
  type FeedbackListItem,
  type FeedbackDetail,
  type FeedbackCommentRow,
  type FeedbackCreateInput,
  type SimilarHit,
} from "./feedback";
export {
  createProceduresClient,
  type ProceduresClient,
  type ProcedureSaveInput,
  type ProcedureInvokeResult,
} from "./procedures";
export {
  createEnumsClient,
  type EnumsClient,
  type EnumSaveInput,
  type EnumValue,
} from "./enums";
export {
  createSavedViewsClient,
  type SavedViewsClient,
  type SavedView,
  type SavedViewSaveInput,
} from "./saved-views";
export {
  createRecordCommentsClient,
  type RecordCommentsClient,
  type RecordComment,
} from "./record-comments";
export {
  createEntityWebhooksClient,
  type EntityWebhooksClient,
  type EntityWebhook,
  type EntityWebhookSaveInput,
} from "./entity-webhooks";
export {
  createEmbedClient,
  type EmbedClient,
  type EmbedScope,
} from "./embed";
export { createConfigClient, type LlmProfileInput } from "./config";
export {
  createKnowledgeClient,
  type KnowledgeClient,
  type KnowledgeSource,
  type KnowledgeHit,
  type EmbeddingProfileInput,
} from "./knowledge";
export {
  createObjectsClient,
  type ObjectsClient,
  type EntitySaveInput,
  type EntityFieldInput,
  type PageSaveInput,
  type AgentSaveInput,
  type AgentMemberRole,
  type AgentMemberRow,
  type WorkflowSaveInput,
  type ScheduleSaveInput,
} from "./objects";
export {
  createIotClient,
  type IotClient,
  type IotDevice,
  type IotTelemetryRow,
  type IotCommandRow,
} from "./iot";
export {
  createBackupClient,
  type BackupClient,
  type BackupConfigView,
  type BackupRun,
} from "./backup";
