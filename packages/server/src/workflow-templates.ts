/* ==========================================================
   workflow-templates.ts — Thư viện template workflow dựng sẵn.
   Dữ liệu TĨNH (không lưu DB) — mirror agent-templates.ts. Server expose
   qua workflows.listTemplates; "Kích hoạt" → workflows.instantiateTemplate
   deep-clone graph thành workflow mới của công ty (lưu sourceTemplateId).

   graph theo shape ReactFlow designer lưu: node { id, type:"wf", position,
   data:{ kind, label, config } }; edge { source, target, label? }. Runner đọc
   data.kind làm node.type (xem run-workflow.ts mapGraph).
   ========================================================== */

type WfTrigger = "manual" | "webhook" | "cron" | "entity_changed" | "iot_telemetry";

interface TplNode {
  id: string;
  type: "wf";
  position: { x: number; y: number };
  data: { kind: string; label: string; config?: Record<string, unknown> };
}
interface TplEdge {
  id: string;
  source: string;
  target: string;
  type: "wf";
  label?: string;
}

export interface WorkflowTemplate {
  id: string;
  category: string; // nhãn hiển thị (tiếng Việt)
  categoryKey: string; // machine name để lọc
  icon: string; // tên icon trong src/components/Icons.tsx
  name: string;
  description: string;
  tags: string[];
  triggerType: WfTrigger;
  graph: { nodes: TplNode[]; edges: TplEdge[] };
}

/** Helper dựng node gọn (x tăng dần để layout ngang). */
function n(
  id: string,
  kind: string,
  label: string,
  x: number,
  config?: Record<string, unknown>,
): TplNode {
  return { id, type: "wf", position: { x, y: 140 }, data: { kind, label, config } };
}
/** Helper dựng control-edge (label tuỳ chọn cho nhánh yes/no/approved...). */
function e(source: string, target: string, label?: string): TplEdge {
  return {
    id: `${source}-${target}${label ? `-${label}` : ""}`,
    source,
    target,
    type: "wf",
    label,
  };
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  /* ─── PHÊ DUYỆT ─────────────────────────────────────────── */
  {
    id: "approve_large_order",
    category: "Phê duyệt",
    categoryKey: "approval",
    icon: "User",
    name: "Duyệt đơn hàng lớn",
    description: "Đơn vượt hạn mức → chờ quản lý duyệt → thông báo kết quả.",
    tags: ["phe_duyet", "don_hang", "thong_bao"],
    triggerType: "manual",
    graph: {
      nodes: [
        n("t", "trigger", "Bắt đầu", 80),
        n("c", "condition", "Vượt hạn mức?", 320, { expr: "{total} > 50000000" }),
        n("ap", "approval", "Quản lý duyệt", 560),
        n("notify", "action", "Thông báo kết quả", 800, { tool: "notif.internal.send" }),
      ],
      edges: [e("t", "c"), e("c", "ap", "true"), e("ap", "notify", "approved")],
    },
  },
  {
    id: "two_stage_approval",
    category: "Phê duyệt",
    categoryKey: "approval",
    icon: "Users",
    name: "Phê duyệt 2 cấp",
    description: "Trưởng phòng duyệt trước, giám đốc duyệt sau, rồi thực thi.",
    tags: ["phe_duyet", "nhieu_cap"],
    triggerType: "manual",
    graph: {
      nodes: [
        n("t", "trigger", "Bắt đầu", 80),
        n("a1", "approval", "Trưởng phòng duyệt", 320),
        n("a2", "approval", "Giám đốc duyệt", 560),
        n("done", "action", "Thực thi", 800, { tool: "notif.internal.send" }),
      ],
      edges: [e("t", "a1"), e("a1", "a2", "approved"), e("a2", "done", "approved")],
    },
  },

  /* ─── TỰ ĐỘNG HOÁ ───────────────────────────────────────── */
  {
    id: "daily_reminder",
    category: "Tự động hoá",
    categoryKey: "automation",
    icon: "Bell",
    name: "Nhắc việc hằng ngày",
    description: "Theo lịch cron → agent tổng hợp việc cần làm → gửi thông báo.",
    tags: ["tu_dong", "nhac_viec", "cron"],
    triggerType: "cron",
    graph: {
      nodes: [
        n("t", "trigger", "Theo lịch", 80),
        n("ag", "agent", "Tổng hợp việc", 320, {
          system: "Bạn tổng hợp danh sách việc cần làm hôm nay, ngắn gọn theo gạch đầu dòng.",
        }),
        n("notify", "action", "Gửi nhắc nhở", 560, { tool: "notif.internal.send" }),
      ],
      edges: [e("t", "ag"), e("ag", "notify")],
    },
  },

  /* ─── DỮ LIỆU ───────────────────────────────────────────── */
  {
    id: "data_sync",
    category: "Dữ liệu",
    categoryKey: "data",
    icon: "Server",
    name: "Đồng bộ dữ liệu định kỳ",
    description: "Theo lịch → gọi API nguồn → ghi/cập nhật bản ghi ERP.",
    tags: ["du_lieu", "dong_bo", "cron"],
    triggerType: "cron",
    graph: {
      nodes: [
        n("t", "trigger", "Theo lịch", 80),
        n("fetch", "http", "Lấy dữ liệu nguồn", 320, { method: "GET", url: "" }),
        n("save", "action", "Ghi bản ghi", 560, { tool: "erp.records.upsert" }),
      ],
      edges: [e("t", "fetch"), e("fetch", "save")],
    },
  },

  /* ─── TÀI LIỆU / BÁO CÁO ────────────────────────────────── */
  {
    id: "scheduled_report",
    category: "Tài liệu",
    categoryKey: "docs",
    icon: "BookOpen",
    name: "Báo cáo định kỳ",
    description: "Theo lịch → agent soạn báo cáo từ dữ liệu → gửi email.",
    tags: ["bao_cao", "email", "cron"],
    triggerType: "cron",
    graph: {
      nodes: [
        n("t", "trigger", "Theo lịch", 80),
        n("ag", "agent", "Soạn báo cáo", 320, {
          system: "Bạn soạn báo cáo tóm tắt hoạt động trong kỳ, rõ ràng, có số liệu chính.",
        }),
        n("mail", "action", "Gửi email", 560, { tool: "notif.email.send" }),
      ],
      edges: [e("t", "ag"), e("ag", "mail")],
    },
  },

  /* ─── CHẤT LƯỢNG (self-correcting loop) ─────────────────── */
  {
    id: "self_correcting_loop",
    category: "Chất lượng",
    categoryKey: "quality",
    icon: "RefreshCw",
    name: "Vòng lặp tự sửa tới khi đạt",
    description:
      "Lặp một workflow con (sửa + kiểm) tới khi điều kiện đạt, có trần số vòng — rồi thông báo.",
    tags: ["loop_until", "tu_sua", "chat_luong"],
    triggerType: "manual",
    graph: {
      nodes: [
        n("t", "trigger", "Bắt đầu", 80),
        // workflowId để trống — người dùng chọn workflow con sau khi kích hoạt.
        n("loop", "loop-until", "Lặp tới khi đạt", 320, {
          expr: '{status} == "done"',
          maxIterations: 10,
          workflowId: "",
        }),
        n("notify", "action", "Thông báo kết quả", 560, { tool: "notif.internal.send" }),
      ],
      edges: [e("t", "loop"), e("loop", "notify")],
    },
  },
];
