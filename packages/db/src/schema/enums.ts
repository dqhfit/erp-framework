/* Enum dùng chung — KHÔNG import bảng nào (tránh circular eager). */
import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "editor", "viewer"]);
export const workflowTrigger = pgEnum("workflow_trigger", [
  "manual",
  "webhook",
  "cron",
  "entity_changed",
  "iot_telemetry",
]);
export const runStatus = pgEnum("run_status", ["running", "completed", "paused", "error"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const feedbackStatus = pgEnum("feedback_status", ["new", "in_progress", "done", "wontfix"]);
export const feedbackSeverity = pgEnum("feedback_severity", ["nice_to_have", "normal", "blocker"]);
