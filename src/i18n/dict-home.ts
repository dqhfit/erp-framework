/* ==========================================================
   dict-home.ts — Key i18n cho trang chủ (Home / index.tsx).
   Tách riêng để dict.ts không phình.
   ========================================================== */
type Dict = Record<string, string>;

export const homeVi: Dict = {
  // greeting theo giờ
  "home.greeting_morning": "Chào buổi sáng",
  "home.greeting_noon":    "Chào buổi trưa",
  "home.greeting_evening": "Chào buổi chiều",
  "home.greeting_night":   "Chào buổi tối",

  // hero
  "home.hero_title": "Bạn muốn xây gì hôm nay?",

  // nút tạo nhanh
  "home.btn_entity":   "+ Entity mới",
  "home.btn_page":     "+ Page mới",
  "home.btn_workflow": "+ Workflow mới",
  "home.btn_agent":    "+ Agent mới",

  // section gần đây
  "home.recent_title":    "Gần đây",
  "home.recent_view_all": "Xem tất cả",
  "home.recent_empty":    "Chưa có đối tượng nào. Bấm \"+ Entity mới\" để bắt đầu.",

  // templates
  "home.templates_title": "Bắt đầu nhanh với template",
  "home.template_use":    "Dùng template",

  "home.tpl_crm_name":       "CRM cơ bản",
  "home.tpl_crm_desc":       "Khách hàng, Cơ hội, Hợp đồng",
  "home.tpl_orders_name":    "Quản lý đơn hàng",
  "home.tpl_orders_desc":    "Đơn, Khách hàng, Sản phẩm",
  "home.tpl_warehouse_name": "Kho thông minh",
  "home.tpl_warehouse_desc": "Kho, Sản phẩm, Phiếu nhập xuất",
  "home.tpl_hr_name":        "HR + Chấm công",
  "home.tpl_hr_desc":        "Nhân viên, Chấm công, Nghỉ phép",

  // side rail
  "home.ai_desc":        "Mô tả nhu cầu, AI sẽ phác thảo entity + workflow giúp bạn.",
  "home.ai_placeholder": "Ví dụ: Tôi muốn quản lý đơn hàng, tự duyệt nếu < 5tr, gửi email khi đã giao.",
  "home.ai_btn":         "Phác thảo bằng AI",

  "home.activity_title": "Hoạt động hệ thống",

  "home.cmd_hint": "Mở Command Palette để tìm nhanh mọi thứ.",

  "home.guide_title": "Hướng dẫn sử dụng",
  "home.guide_desc":  "Cách dùng hệ thống, từng bước",
};

export const homeEn: Dict = {
  // greeting
  "home.greeting_morning": "Good morning",
  "home.greeting_noon":    "Good afternoon",
  "home.greeting_evening": "Good evening",
  "home.greeting_night":   "Good night",

  // hero
  "home.hero_title": "What would you like to build today?",

  // quick-create buttons
  "home.btn_entity":   "+ New Entity",
  "home.btn_page":     "+ New Page",
  "home.btn_workflow": "+ New Workflow",
  "home.btn_agent":    "+ New Agent",

  // recent
  "home.recent_title":    "Recent",
  "home.recent_view_all": "View all",
  "home.recent_empty":    "No objects yet. Click \"+ New Entity\" to start.",

  // templates
  "home.templates_title": "Quick start with templates",
  "home.template_use":    "Use template",

  "home.tpl_crm_name":       "Basic CRM",
  "home.tpl_crm_desc":       "Customers, Opportunities, Contracts",
  "home.tpl_orders_name":    "Order Management",
  "home.tpl_orders_desc":    "Orders, Customers, Products",
  "home.tpl_warehouse_name": "Smart Warehouse",
  "home.tpl_warehouse_desc": "Warehouse, Products, Receipts",
  "home.tpl_hr_name":        "HR + Attendance",
  "home.tpl_hr_desc":        "Employees, Attendance, Leave",

  // side rail
  "home.ai_desc":        "Describe your needs — AI will sketch entity + workflow for you.",
  "home.ai_placeholder": "E.g. I want order management, auto-approve if < 5M, send email when delivered.",
  "home.ai_btn":         "Sketch with AI",

  "home.activity_title": "System Activity",

  "home.cmd_hint": "Open Command Palette to search everything quickly.",

  "home.guide_title": "User Guide",
  "home.guide_desc":  "Step-by-step system usage",
};
