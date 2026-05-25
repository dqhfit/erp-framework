/* ==========================================================
   dict-chrome.ts — Key i18n cho nhóm "chrome" (khung app):
   Sidebar nav, Topbar, CompanySwitcher, CommandPalette,
   AuthGate, OAuth callback. Tách riêng để dict.ts không phình.
   dict.ts gộp các map này vào DICT.
   ========================================================== */
type Dict = Record<string, string>;

export const chromeVi: Dict = {
  // sidebar — nav cố định
  "sidebar.server_data": "Dữ liệu Server",
  "sidebar.approvals": "Phê duyệt",
  "sidebar.org_chart": "Sơ đồ agent",
  "sidebar.companies": "Công ty",
  "sidebar.transfer": "Xuất / Nhập cấu hình",
  "sidebar.plugins": "Plugin",
  "sidebar.embed": "Nhúng (Embed)",
  "sidebar.logout": "Đăng xuất",
  "topbar.user_menu_companies": "Quản lý công ty",
  "topbar.user_menu_llm": "Cài đặt LLM",

  // topbar — title/nhãn còn sót
  "topbar.mcp_connected": "MCP đã kết nối",
  "topbar.no_llm_profile": "Chưa có LLM profile",
  "topbar.llm_profile": "Profile: {name}",
  "topbar.tweaks": "Tinh chỉnh (giao diện / mật độ / màu nhấn)",

  // company switcher
  "company.active_title": "Công ty đang làm việc",
  "company.fallback": "Công ty",
  "company.your_companies": "Công ty của bạn",
  "company.none": "Chưa có công ty",
  "company.manage": "Quản lý công ty",

  // command palette
  "cmd.workspace": "Workspace",
  "cmd.home_hint": "Trang chủ",
  "cmd.ask_agent": "Hỏi Agent",
  "cmd.ask_agent_hint": "Mở chat panel",
  "cmd.settings_llm": "Cài đặt LLM",
  "cmd.settings_llm_hint": "Profile / API key",
  "cmd.settings_mcp": "Cài đặt MCP",
  "cmd.settings_mcp_hint": "Server URL",
  "cmd.placeholder": "Gõ để tìm entity, page, workflow, lệnh…",
  "cmd.empty": "Không tìm thấy.",
  "cmd.hint_entity": "Entity · {mcp}",
  "cmd.hint_page": "Page",
  "cmd.hint_workflow": "Workflow · {runs} runs",
  "cmd.hint_agent": "Agent · {model}",
  "cmd.nav_select": "Chọn",
  "cmd.nav_open": "Mở",
  "cmd.nav_toggle": "Bật/tắt",

  // auth gate
  "auth.login_title": "Đăng nhập",
  "auth.register_title": "Tạo tài khoản quản trị",
  "auth.login_sub": "Đăng nhập để dùng ERP Framework.",
  "auth.register_sub": "Tài khoản đầu tiên sẽ là quản trị viên.",
  "auth.email": "Email",
  "auth.email_ph": "ban@congty.com",
  "auth.name": "Tên hiển thị",
  "auth.name_ph": "Nguyễn Văn A",
  "auth.password": "Mật khẩu",
  "auth.password_hint": "Tối thiểu 8 ký tự",
  "auth.processing": "Đang xử lý…",
  "auth.submit_login": "Đăng nhập",
  "auth.submit_register": "Đăng ký & vào app",
  "auth.to_register": "Chưa có tài khoản? Tạo tài khoản quản trị",
  "auth.to_login": "Đã có tài khoản? Đăng nhập",
  "auth.checking": "Đang kiểm tra phiên…",
  "auth.login_failed": "Đăng nhập thất bại",
  "auth.register_failed": "Đăng ký thất bại",
  "auth.error_rate_limit": "Quá nhiều lần thử, vui lòng đợi vài phút.",
  "auth.banner_first_admin_existed": "Tài khoản quản trị đã được khởi tạo. Vui lòng đăng nhập.",

  // sidebar — nav bổ sung (chưa có trong dict.ts)
  "sidebar.iot": "Thiết bị IoT",
  "sidebar.procedures": "Thủ tục",
  "sidebar.enums": "Danh mục",
  "sidebar.tools": "Tools",
  "sidebar.feedback": "Phản hồi",
  "sidebar.my_agents": "Agent của tôi",
  "sidebar.backup": "Sao lưu",
  "sidebar.tools_mgmt": "Quản lý Tools",

  // oauth callback
  "oauth.verifying": "Đang xác thực với Anthropic...",
  "oauth.please_wait": "Vui lòng đợi.",
  "oauth.success": "Đăng nhập thành công!",
  "oauth.redirecting": "Đang chuyển về cài đặt...",
  "oauth.failed": "Đăng nhập thất bại",
  "oauth.back_to_settings": "Về cài đặt",
  "oauth.err_code": "OAuth lỗi: {error} — {desc}",
  "oauth.err_no_code": "Thiếu authorization code trong callback URL",
};

export const chromeEn: Dict = {
  // sidebar
  "sidebar.server_data": "Server Data",
  "sidebar.approvals": "Approvals",
  "sidebar.org_chart": "Agent Org Chart",
  "sidebar.companies": "Companies",
  "sidebar.transfer": "Export / Import",
  "sidebar.plugins": "Plugins",
  "sidebar.embed": "Embed",
  "sidebar.logout": "Log out",
  "topbar.user_menu_companies": "Manage companies",
  "topbar.user_menu_llm": "LLM settings",

  // topbar
  "topbar.mcp_connected": "MCP connected",
  "topbar.no_llm_profile": "No LLM profile",
  "topbar.llm_profile": "Profile: {name}",
  "topbar.tweaks": "Tweaks (theme / density / accent)",

  // company switcher
  "company.active_title": "Active company",
  "company.fallback": "Company",
  "company.your_companies": "Your companies",
  "company.none": "No company yet",
  "company.manage": "Manage companies",

  // command palette
  "cmd.workspace": "Workspace",
  "cmd.home_hint": "Home",
  "cmd.ask_agent": "Ask Agent",
  "cmd.ask_agent_hint": "Open chat panel",
  "cmd.settings_llm": "LLM Settings",
  "cmd.settings_llm_hint": "Profile / API key",
  "cmd.settings_mcp": "MCP Settings",
  "cmd.settings_mcp_hint": "Server URL",
  "cmd.placeholder": "Type to search entities, pages, workflows, commands…",
  "cmd.empty": "No results.",
  "cmd.hint_entity": "Entity · {mcp}",
  "cmd.hint_page": "Page",
  "cmd.hint_workflow": "Workflow · {runs} runs",
  "cmd.hint_agent": "Agent · {model}",
  "cmd.nav_select": "Select",
  "cmd.nav_open": "Open",
  "cmd.nav_toggle": "Toggle",

  // auth gate
  "auth.login_title": "Sign in",
  "auth.register_title": "Create admin account",
  "auth.login_sub": "Sign in to use ERP Framework.",
  "auth.register_sub": "The first account becomes the administrator.",
  "auth.email": "Email",
  "auth.email_ph": "you@company.com",
  "auth.name": "Display name",
  "auth.name_ph": "Jane Doe",
  "auth.password": "Password",
  "auth.password_hint": "At least 8 characters",
  "auth.processing": "Processing…",
  "auth.submit_login": "Sign in",
  "auth.submit_register": "Register & enter",
  "auth.to_register": "No account? Create admin account",
  "auth.to_login": "Already have an account? Sign in",
  "auth.checking": "Checking session…",
  "auth.login_failed": "Sign-in failed",
  "auth.register_failed": "Registration failed",
  "auth.error_rate_limit": "Too many attempts, please wait a few minutes.",
  "auth.banner_first_admin_existed": "Admin account already exists. Please sign in.",

  // sidebar — nav additions
  "sidebar.iot": "IoT Devices",
  "sidebar.procedures": "Procedures",
  "sidebar.enums": "Categories",
  "sidebar.tools": "Tools",
  "sidebar.feedback": "Feedback",
  "sidebar.my_agents": "My Agents",
  "sidebar.backup": "Backup",
  "sidebar.tools_mgmt": "Manage Tools",

  // oauth callback
  "oauth.verifying": "Authenticating with Anthropic...",
  "oauth.please_wait": "Please wait.",
  "oauth.success": "Signed in successfully!",
  "oauth.redirecting": "Redirecting to settings...",
  "oauth.failed": "Sign-in failed",
  "oauth.back_to_settings": "Back to settings",
  "oauth.err_code": "OAuth error: {error} — {desc}",
  "oauth.err_no_code": "Missing authorization code in callback URL",
};
