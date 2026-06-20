/* ==========================================================
   agent-templates.ts — barrel gộp 41 template agent theo phòng ban.
   Dữ liệu tĩnh (không lưu DB); server expose qua agents.listTemplates.
   Khi user "Kích hoạt", agents.instantiateTemplate insert vào agents.
   Mỗi phòng ban tách ra file riêng trong agent-templates/.
   ========================================================== */

import { ACCOUNTING_TEMPLATES } from "./agent-templates/accounting";
import { CUSTOMER_SERVICE_TEMPLATES } from "./agent-templates/customer-service";
import { HR_TEMPLATES } from "./agent-templates/hr";
import { LEGAL_TEMPLATES } from "./agent-templates/legal";
import { LOGISTICS_TEMPLATES } from "./agent-templates/logistics";
import { MANUFACTURING_TEMPLATES } from "./agent-templates/manufacturing";
import { MARKETING_TEMPLATES } from "./agent-templates/marketing";
import { PROCUREMENT_TEMPLATES } from "./agent-templates/procurement";
import { SALES_TEMPLATES } from "./agent-templates/sales";
import { SYSTEM_TEMPLATES } from "./agent-templates/system";
import type { AgentTemplate } from "./agent-templates/types";

export type { AgentTemplate } from "./agent-templates/types";

export const AGENT_TEMPLATES: AgentTemplate[] = [
  ...ACCOUNTING_TEMPLATES,
  ...SALES_TEMPLATES,
  ...HR_TEMPLATES,
  ...PROCUREMENT_TEMPLATES,
  ...LOGISTICS_TEMPLATES,
  ...MANUFACTURING_TEMPLATES,
  ...MARKETING_TEMPLATES,
  ...CUSTOMER_SERVICE_TEMPLATES,
  ...LEGAL_TEMPLATES,
  ...SYSTEM_TEMPLATES,
];

export const TEMPLATE_DEPARTMENTS = [
  { key: "ke_toan", label: "Kế toán" },
  { key: "kinh_doanh", label: "Kinh doanh" },
  { key: "nhan_su", label: "Nhân sự" },
  { key: "mua_hang", label: "Mua hàng" },
  { key: "kho_van", label: "Kho vận" },
  { key: "san_xuat", label: "Sản xuất" },
  { key: "marketing", label: "Marketing" },
  { key: "cham_soc_kh", label: "CSKH" },
  { key: "phap_che", label: "Pháp chế" },
  { key: "he_thong", label: "Hệ thống" },
] as const;
