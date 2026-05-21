/* @erp-framework/client — DataSource + client xác thực + client
   cấu hình cho frontend. App chọn rồi inject vào core/ui. */
export { LocalStorageDataSource } from "./local-storage";
export { ApiDataSource, createApiDataSource } from "./api";
export { createAuthClient } from "./auth";
export { createConfigClient, type LlmProfileInput } from "./config";
export {
  createObjectsClient,
  type ObjectsClient,
  type EntitySaveInput,
  type EntityFieldInput,
  type PageSaveInput,
  type AgentSaveInput,
  type WorkflowSaveInput,
  type ScheduleSaveInput,
} from "./objects";
