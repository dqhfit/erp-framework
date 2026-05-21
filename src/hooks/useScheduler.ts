/* ==========================================================
   useScheduler — Khởi động scheduler runtime một lần ở app root.
   Runner đọc nội dung workflow đã lưu (userObjects) rồi chạy
   thật bằng runWorkflow. Chỉ hoạt động khi app đang mở.
   ========================================================== */
import { useEffect } from "react";
import { startScheduler, stopScheduler } from "@/core/scheduler";
import { runWorkflow, type WfNode, type WfEdge } from "@/core/workflow-runner";
import { callToolReal, callAgentReal } from "@/core/workflow-callbacks";
import { useUserObjects } from "@/stores/userObjects";
import { logActivity } from "@/stores/activity";

interface StoredNode {
  id: string;
  data?: { kind?: string; label?: string; config?: Record<string, unknown> };
}
interface StoredEdge {
  source: string;
  target: string;
  label?: unknown;
}

export function useScheduler(): void {
  useEffect(() => {
    startScheduler(async (schedule) => {
      const content = useUserObjects.getState().workflowContent[schedule.workflowId] as
        { nodes?: StoredNode[]; edges?: StoredEdge[] } | undefined;
      if (!content?.nodes?.length) {
        logActivity({
          kind: "error", objectType: "workflow", target: schedule.workflowName,
          detail: `Lịch chạy: workflow "${schedule.workflowId}" chưa có nội dung đã lưu.`,
        });
        return "error";
      }
      const nodes: WfNode[] = content.nodes.map((n) => ({
        id: n.id,
        type: n.data?.kind ?? "action",
        label: n.data?.label ?? n.id,
        config: n.data?.config,
      }));
      const edges: WfEdge[] = (content.edges ?? []).map((e) => ({
        source: e.source,
        target: e.target,
        label: typeof e.label === "string" ? e.label : undefined,
      }));
      const r = await runWorkflow({
        workflowId: schedule.workflowId,
        workflowName: schedule.workflowName,
        nodes,
        edges,
        callTool: callToolReal,
        callAgent: callAgentReal,
      });
      return r.status;
    });
    return () => stopScheduler();
  }, []);
}
