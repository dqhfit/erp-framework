/* ==========================================================
   dict-home.ts — Key i18n cho trang chủ (Home / index.tsx).
   Tách riêng để dict.ts không phình.
   ========================================================== */
type Dict = Record<string, string>;

export const homeVi: Dict = {
  // greeting theo giờ
  "home.greeting_morning": "Chào buổi sáng",
  "home.greeting_noon": "Chào buổi trưa",
  "home.greeting_evening": "Chào buổi chiều",
  "home.greeting_night": "Chào buổi tối",

  // hero
  "home.hero_title": "Bạn muốn xây gì hôm nay?",

  // nút tạo nhanh
  "home.btn_entity": "+ Entity mới",
  "home.btn_page": "+ Page mới",
  "home.btn_workflow": "+ Workflow mới",
  "home.btn_agent": "+ Agent mới",

  // section gần đây
  "home.recent_title": "Gần đây",
  "home.recent_view_all": "Xem tất cả",
  "home.recent_empty": 'Chưa có đối tượng nào. Bấm "+ Entity mới" để bắt đầu.',

  // thống kê bản ghi theo đối tượng
  "home.records_title": "Bản ghi theo đối tượng",
  "home.records_total": "Tổng {n} bản ghi",
  "home.records_loading": "Đang đếm bản ghi…",
  "home.records_empty": "Chưa có đối tượng nào để thống kê.",

  // truy cập nhanh — ghim công việc thường xuyên
  "home.pinned_title": "Truy cập nhanh",
  "home.pinned_add": "Ghim",
  "home.pinned_remove": "Bỏ ghim",
  "home.pinned_empty": 'Chưa ghim mục nào. Bấm "Ghim" để thêm công việc thường dùng vào đây.',
  "home.pin_modal_title": "Ghim truy cập nhanh",
  "home.pin_search": "Tìm trang, đối tượng, workflow, agent…",
  "home.pin_hint": "Bấm để ghim/bỏ ghim. Mục đã ghim cũng hiện ở ★ trên sidebar.",
  "home.pin_empty_results": "Không tìm thấy mục nào.",
  "home.pin_more": "… và {n} mục nữa — gõ để lọc.",

  // templates
  "home.templates_title": "Bắt đầu nhanh với template",
  "home.template_use": "Dùng template",

  "home.tpl_crm_name": "CRM cơ bản",
  "home.tpl_crm_desc": "Khách hàng, Cơ hội, Hợp đồng",
  "home.tpl_orders_name": "Quản lý đơn hàng",
  "home.tpl_orders_desc": "Đơn, Khách hàng, Sản phẩm",
  "home.tpl_warehouse_name": "Kho thông minh",
  "home.tpl_warehouse_desc": "Kho, Sản phẩm, Phiếu nhập xuất",
  "home.tpl_hr_name": "HR + Chấm công",
  "home.tpl_hr_desc": "Nhân viên, Chấm công, Nghỉ phép",

  // side rail
  "home.ai_desc": "Mô tả nhu cầu, AI sẽ phác thảo entity + workflow giúp bạn.",
  "home.ai_placeholder":
    "Ví dụ: Tôi muốn quản lý đơn hàng, tự duyệt nếu < 5tr, gửi email khi đã giao.",
  "home.ai_btn": "Phác thảo bằng AI",

  "home.activity_title": "Hoạt động hệ thống",

  "home.cmd_hint": "Mở Command Palette để tìm nhanh mọi thứ.",

  // phím tắt (side rail)
  "home.shortcuts_title": "Phím tắt",
  "home.shortcuts_customize": "Tuỳ chỉnh",
  "home.shortcuts_palette_alt": "Hoặc mở nhanh Command Palette",

  "home.guide_title": "Hướng dẫn sử dụng",
  "home.guide_desc": "Cách dùng hệ thống, từng bước",
};

export const homeEn: Dict = {
  // greeting
  "home.greeting_morning": "Good morning",
  "home.greeting_noon": "Good afternoon",
  "home.greeting_evening": "Good evening",
  "home.greeting_night": "Good night",

  // hero
  "home.hero_title": "What would you like to build today?",

  // quick-create buttons
  "home.btn_entity": "+ New Entity",
  "home.btn_page": "+ New Page",
  "home.btn_workflow": "+ New Workflow",
  "home.btn_agent": "+ New Agent",

  // recent
  "home.recent_title": "Recent",
  "home.recent_view_all": "View all",
  "home.recent_empty": 'No objects yet. Click "+ New Entity" to start.',

  // records-by-object stats
  "home.records_title": "Records by object",
  "home.records_total": "{n} records total",
  "home.records_loading": "Counting records…",
  "home.records_empty": "No objects to report yet.",

  // quick access — pinned frequent work
  "home.pinned_title": "Quick access",
  "home.pinned_add": "Pin",
  "home.pinned_remove": "Unpin",
  "home.pinned_empty": 'Nothing pinned yet. Click "Pin" to add your frequent work here.',
  "home.pin_modal_title": "Pin for quick access",
  "home.pin_search": "Search pages, objects, workflows, agents…",
  "home.pin_hint": "Click to pin/unpin. Pinned items also appear under ★ in the sidebar.",
  "home.pin_empty_results": "No items found.",
  "home.pin_more": "… and {n} more — type to filter.",

  // templates
  "home.templates_title": "Quick start with templates",
  "home.template_use": "Use template",

  "home.tpl_crm_name": "Basic CRM",
  "home.tpl_crm_desc": "Customers, Opportunities, Contracts",
  "home.tpl_orders_name": "Order Management",
  "home.tpl_orders_desc": "Orders, Customers, Products",
  "home.tpl_warehouse_name": "Smart Warehouse",
  "home.tpl_warehouse_desc": "Warehouse, Products, Receipts",
  "home.tpl_hr_name": "HR + Attendance",
  "home.tpl_hr_desc": "Employees, Attendance, Leave",

  // side rail
  "home.ai_desc": "Describe your needs — AI will sketch entity + workflow for you.",
  "home.ai_placeholder":
    "E.g. I want order management, auto-approve if < 5M, send email when delivered.",
  "home.ai_btn": "Sketch with AI",

  "home.activity_title": "System Activity",

  "home.cmd_hint": "Open Command Palette to search everything quickly.",

  // keyboard shortcuts (side rail)
  "home.shortcuts_title": "Shortcuts",
  "home.shortcuts_customize": "Customize",
  "home.shortcuts_palette_alt": "Or quickly open Command Palette",

  "home.guide_title": "User Guide",
  "home.guide_desc": "Step-by-step system usage",
};
