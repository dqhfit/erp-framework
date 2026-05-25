/* ==========================================================
   dict-settings.ts — Key i18n cho cac trang Settings
   (companies, rbac, agents, backup, embedding, plugins, transfer).
   Tach rieng de dict.ts khong phinh.
   ========================================================== */
type Dict = Record<string, string>;

export const settingsVi: Dict = {
  // --- companies ---
  "settings.companies.title": "Quản lý công ty",
  "settings.companies.subtitle":
    "Mỗi công ty có dữ liệu riêng (entity, trang, workflow, agent, nhật ký…). Người dùng có thể thuộc nhiều công ty và chuyển qua lại.",
  "settings.companies.current_company": "Công ty đang làm việc",
  "settings.companies.rename_btn": "Đổi tên",
  "settings.companies.renamed_ok": "✓ Đã đổi tên công ty.",
  "settings.companies.your_role": "Vai trò của bạn ở công ty này:",
  "settings.companies.my_companies": "Công ty của bạn",
  "settings.companies.active_chip": "Đang dùng",
  "settings.companies.switch_btn": "Chuyển đến",
  "settings.companies.no_company": "Chưa thuộc công ty nào.",
  "settings.companies.new_company_placeholder": "Tên công ty mới…",
  "settings.companies.create_btn": "Tạo công ty",
  "settings.companies.create_ok": "✓ Đã tạo công ty mới.",
  "settings.companies.admin_hint": "Bạn sẽ là quản trị viên của công ty vừa tạo.",
  "settings.companies.members_title": "Thành viên công ty",
  "settings.companies.col_user": "Người dùng",
  "settings.companies.col_role": "Vai trò",
  "settings.companies.col_actions": "Thao tác",
  "settings.companies.pending_chip": "chờ accept",
  "settings.companies.no_members": "Chưa có thành viên nào hiển thị.",
  "settings.companies.role_changed_ok": "✓ Đã đổi vai trò.",
  "settings.companies.resend_btn": "Gửi lại",
  "settings.companies.resend_ok": "✓ Đã sinh link mới — đã copy vào clipboard.",
  "settings.companies.reset_pass_btn": "Reset pass",
  "settings.companies.remove_confirm": "Gỡ {email} khỏi công ty?",
  "settings.companies.remove_title": "Gỡ thành viên",
  "settings.companies.remove_confirm_btn": "Gỡ",
  "settings.companies.removed_ok": "✓ Đã gỡ thành viên.",
  "settings.companies.invite_title": "Mời thành viên qua link đăng ký",
  "settings.companies.invite_email_ph": "Email",
  "settings.companies.invite_name_ph": "Tên hiển thị (tuỳ chọn)",
  "settings.companies.invite_btn": "Tạo tài khoản + sinh link đăng ký",
  "settings.companies.invite_ok":
    "✓ Đã tạo tài khoản. Link đăng ký đã copy vào clipboard.",
  "settings.companies.invite_hint":
    "Server tạo tài khoản với mật khẩu trống, sinh link đăng ký 1 lần có hiệu lực 7 ngày. Bạn copy link gửi cho user — họ tự đặt mật khẩu khi vào link. Email đã có user → chỉ gán quyền, không sinh link.",
  "settings.companies.link_label": "Link đăng ký cho",
  "settings.companies.link_expires":
    'Hết hạn sau 7 ngày. User mở link → đặt mật khẩu → vào app. Có thể sinh lại link bằng nút "Gửi lại" cạnh chip "chờ accept".',
  "settings.companies.reset_panel_title": "Đặt lại mật khẩu cho",
  "settings.companies.reset_pwd_ph": "Mật khẩu mới (tối thiểu 8 ký tự)",
  "settings.companies.reset_confirm_btn": "Xác nhận đặt lại",
  "settings.companies.reset_ok":
    "✓ Đã đặt lại mật khẩu cho {email}. Mọi phiên của user đó đã bị đăng xuất.",
  "settings.companies.reset_hint":
    "User sẽ bị đăng xuất khỏi tất cả thiết bị và phải đăng nhập lại bằng mật khẩu mới.",
  "settings.companies.role_admin": "Quản trị",
  "settings.companies.role_editor": "Biên tập",
  "settings.companies.role_viewer": "Xem",

  // --- rbac ---
  "settings.rbac.title": "Vai trò & Quyền (RBAC)",
  "settings.rbac.subtitle":
    "Phân quyền theo vai trò. UI sẽ ẩn/khoá thao tác mà vai trò hiện tại không được phép.",
  "settings.rbac.enforce_title": "Bật kiểm soát quyền",
  "settings.rbac.enforce_desc":
    "Khi tắt, mọi thao tác được phép (tiện cho dev một người). Khi bật, UI tuân theo vai trò bên dưới.",
  "settings.rbac.enforce_on": "Đang kiểm soát",
  "settings.rbac.enforce_off": "Đang tắt (toàn quyền)",
  "settings.rbac.session_role": "Vai trò phiên hiện tại",
  "settings.rbac.active_chip": "Đang dùng",
  "settings.rbac.matrix_title": "Ma trận quyền — vai trò",
  "settings.rbac.col_object": "Object",
  "settings.rbac.note":
    "Lưu ý: đây là RBAC phía client (chặn UI). Khi triển khai production đa người dùng, vai trò cần được xác thực lại ở backend/bridge.",
  "settings.rbac.obj_entity": "Đối tượng",
  "settings.rbac.obj_page": "Trang",
  "settings.rbac.obj_workflow": "Workflow",
  "settings.rbac.obj_agent": "Agent",
  "settings.rbac.obj_activity": "Nhật ký",
  "settings.rbac.obj_knowledge": "Tri thức",
  "settings.rbac.obj_iot": "IoT",
  "settings.rbac.obj_settings": "Cấu hình",
  "settings.rbac.obj_rbac": "Vai trò",
  "settings.rbac.action_view": "Xem",
  "settings.rbac.action_create": "Tạo",
  "settings.rbac.action_edit": "Sửa",
  "settings.rbac.action_delete": "Xoá",
  "settings.rbac.action_run": "Chạy",

  // --- agents ---
  "settings.agents.title": "Agent của tôi",
  "settings.agents.subtitle":
    "Đặt agent chính bạn hay làm việc cùng và quản lý các agent mà bạn là thành viên. Khi chưa đặt, app vẫn dùng được — Topbar/AgentPanel sẽ ưu tiên CEO mặc định của công ty.",
  "settings.agents.primary_label": "Agent chính",
  "settings.agents.primary_unset":
    "Chưa chọn — app dùng CEO của công ty làm assistant mặc định.",
  "settings.agents.open_btn": "Mở",
  "settings.agents.change_btn": "Đổi",
  "settings.agents.deselect_btn": "Bỏ chọn",
  "settings.agents.pick_btn": "Chọn Agent chính",
  "settings.agents.my_agents_title": "Agent tôi quản ({count})",
  "settings.agents.sidebar_hint": "Mở từng agent qua Sidebar →",
  "settings.agents.empty_title": "Bạn chưa được gán làm thành viên của agent nào",
  "settings.agents.empty_hint":
    "Khi bạn tạo agent mới, bạn tự động trở thành owner. Nhờ admin thêm bạn vào các agent có sẵn.",
  "settings.agents.role_note":
    'Quyền chi tiết: owner = toàn quyền + quản thành viên + xoá; operator = chat + edit cấu hình; observer = chỉ xem + chat. Có thể đổi/gỡ ở tab "Thành viên" của trang agent (chỉ owner).',
  "settings.agents.primary_chip": "chính",

  // --- backup ---
  "settings.backup.title": "Sao lưu Google Drive",
  "settings.backup.subtitle":
    "Dump PostgreSQL + đồng bộ thư mục /data/uploads lên một thư mục Google Drive bạn chọn. Files sync incremental (không re-upload file chưa đổi).",
  "settings.backup.config_title": "Cấu hình",
  "settings.backup.guide_title":
    "Hướng dẫn đăng nhập Google Drive (web) & lấy Folder ID",
  "settings.backup.guide_open": "Mở",
  "settings.backup.guide_close": "Đóng",
  "settings.backup.key_label": "Service account JSON key",
  "settings.backup.key_hint_has": "Đã có key — chỉ điền nếu muốn thay key mới.",
  "settings.backup.key_hint_no":
    "Dán toàn bộ nội dung file JSON (từ GCP → Service Accounts → Keys).",
  "settings.backup.folder_label": "Folder ID Google Drive",
  "settings.backup.folder_hint":
    "Đoạn sau /folders/ trong URL Drive. Phải share quyền Editor cho email service account.",
  "settings.backup.cron_label": "Lịch tự động (cron)",
  "settings.backup.cron_hint": "Để trống = chỉ chạy thủ công khi bấm Backup ngay.",
  "settings.backup.cron_off": "Tắt",
  "settings.backup.test_btn": "Test kết nối",
  "settings.backup.save_btn": "Lưu cấu hình",
  "settings.backup.run_btn": "Backup ngay",
  "settings.backup.history_title": "Lịch sử sao lưu",
  "settings.backup.history_empty": "Chưa có lần backup nào.",
  "settings.backup.save_ok": "Đã lưu cấu hình.",
  "settings.backup.run_ok": "Đã đưa job backup vào hàng đợi.",

  // --- embedding ---
  "settings.embedding.title": "Cấu hình Embedding",
  "settings.embedding.subtitle":
    "Profile sinh embedding cho Knowledge Base. Vector cố định 768 chiều — chọn model trả đúng số chiều này.",
  "settings.embedding.provider_label": "Nhà cung cấp",
  "settings.embedding.model_label": "Model",
  "settings.embedding.endpoint_label": "Endpoint",
  "settings.embedding.endpoint_hint_ollama": "Để trống dùng http://localhost:11434",
  "settings.embedding.endpoint_hint_openai":
    "Để trống dùng https://api.openai.com. Gemini: nhập URL OpenAI-compat.",
  "settings.embedding.apikey_label": "API Key",
  "settings.embedding.apikey_hint": "Mã hoá AES-256-GCM trước khi lưu vào DB",
  "settings.embedding.save_btn": "Lưu cấu hình",
  "settings.embedding.save_ok": "Đã lưu cấu hình embedding.",

  // --- plugins ---
  "settings.plugins.title": "Plugin",
  "settings.plugins.subtitle":
    "Đăng ký plugin theo manifest, bật/tắt ngay lúc chạy mà không cần build lại, và xuất manifest để chia sẻ giữa các bản triển khai.",
  "settings.plugins.registered_title": "Plugin đã đăng ký",
  "settings.plugins.empty": "Chưa có plugin nào.",
  "settings.plugins.enabled_chip": "Bật",
  "settings.plugins.disabled_chip": "Tắt",
  "settings.plugins.export_btn": "Xuất",
  "settings.plugins.exported_ok": '✓ Đã xuất manifest "{name}".',
  "settings.plugins.remove_confirm": 'Gỡ plugin "{name}"?',
  "settings.plugins.remove_title": "Gỡ plugin",
  "settings.plugins.remove_confirm_btn": "Gỡ",
  "settings.plugins.removed_ok": "✓ Đã gỡ plugin.",
  "settings.plugins.register_title": "Đăng ký / nhập plugin",
  "settings.plugins.name_ph": "Tên plugin",
  "settings.plugins.version_ph": "Phiên bản",
  "settings.plugins.manifest_ph": "Manifest (JSON)",
  "settings.plugins.register_btn": "Đăng ký plugin",
  "settings.plugins.register_ok": "✓ Đã đăng ký plugin.",
  "settings.plugins.register_hint":
    "Đăng ký lại cùng tên = cập nhật. Bật/tắt áp dụng ngay, không cần build lại.",
  "settings.plugins.toggle_ok": "✓ Đã cập nhật.",
  "settings.plugins.invalid_json": "Manifest không phải JSON hợp lệ",

  // --- transfer ---
  "settings.transfer.title": "Xuất / Nhập cấu hình",
  "settings.transfer.subtitle":
    'Đóng gói toàn bộ entity, page, workflow, agent thành một file JSON — để sao lưu hoặc chia sẻ "ERP mẫu". (Dữ liệu bản ghi và plugin không nằm trong gói này.)',
  "settings.transfer.export_title": "Xuất cấu hình",
  "settings.transfer.export_desc":
    "Tải về một file JSON chứa mọi đối tượng low-code đang có.",
  "settings.transfer.export_btn": "Tải gói cấu hình",
  "settings.transfer.export_ok": "✓ Đã tải xuống gói cấu hình.",
  "settings.transfer.import_title": "Nhập cấu hình",
  "settings.transfer.import_desc":
    "Chọn file JSON đã xuất. Đối tượng trùng id sẽ bị ghi đè.",
  "settings.transfer.import_btn": "Chọn file để nhập",
  "settings.transfer.import_confirm":
    "Nhập cấu hình sẽ ghi đè các đối tượng trùng id. Tiếp tục?",
  "settings.transfer.import_confirm_title": "Nhập cấu hình",
  "settings.transfer.import_confirm_btn": "Nhập",
  "settings.transfer.import_ok":
    "✓ Đã nhập: {entities} entity · {pages} page · {workflows} workflow · {agents} agent.",
  "settings.transfer.import_error": "Lỗi nhập:",
};

export const settingsEn: Dict = {
  // --- companies ---
  "settings.companies.title": "Company Management",
  "settings.companies.subtitle":
    "Each company has its own data (entities, pages, workflows, agents, activity…). Users can belong to multiple companies and switch between them.",
  "settings.companies.current_company": "Current company",
  "settings.companies.rename_btn": "Rename",
  "settings.companies.renamed_ok": "✓ Company renamed.",
  "settings.companies.your_role": "Your role at this company:",
  "settings.companies.my_companies": "Your companies",
  "settings.companies.active_chip": "Active",
  "settings.companies.switch_btn": "Switch to",
  "settings.companies.no_company": "Not a member of any company.",
  "settings.companies.new_company_placeholder": "New company name…",
  "settings.companies.create_btn": "Create company",
  "settings.companies.create_ok": "✓ New company created.",
  "settings.companies.admin_hint": "You will be the admin of the newly created company.",
  "settings.companies.members_title": "Company members",
  "settings.companies.col_user": "User",
  "settings.companies.col_role": "Role",
  "settings.companies.col_actions": "Actions",
  "settings.companies.pending_chip": "pending",
  "settings.companies.no_members": "No members to display.",
  "settings.companies.role_changed_ok": "✓ Role changed.",
  "settings.companies.resend_btn": "Resend",
  "settings.companies.resend_ok": "✓ New link generated — copied to clipboard.",
  "settings.companies.reset_pass_btn": "Reset pass",
  "settings.companies.remove_confirm": "Remove {email} from the company?",
  "settings.companies.remove_title": "Remove member",
  "settings.companies.remove_confirm_btn": "Remove",
  "settings.companies.removed_ok": "✓ Member removed.",
  "settings.companies.invite_title": "Invite member via registration link",
  "settings.companies.invite_email_ph": "Email",
  "settings.companies.invite_name_ph": "Display name (optional)",
  "settings.companies.invite_btn": "Create account + generate invite link",
  "settings.companies.invite_ok": "✓ Account created. Invite link copied to clipboard.",
  "settings.companies.invite_hint":
    "Server creates an account with empty password, generates a one-time registration link valid for 7 days. Copy the link and send to the user — they set their password when accessing the link. Existing email → only assigns role, no link generated.",
  "settings.companies.link_label": "Registration link for",
  "settings.companies.link_expires":
    'Expires in 7 days. User opens link → sets password → enters app. Can regenerate link via the "Resend" button next to the "pending" chip.',
  "settings.companies.reset_panel_title": "Reset password for",
  "settings.companies.reset_pwd_ph": "New password (minimum 8 characters)",
  "settings.companies.reset_confirm_btn": "Confirm reset",
  "settings.companies.reset_ok":
    "✓ Password reset for {email}. All sessions for that user have been logged out.",
  "settings.companies.reset_hint":
    "User will be logged out of all devices and must log in again with the new password.",
  "settings.companies.role_admin": "Admin",
  "settings.companies.role_editor": "Editor",
  "settings.companies.role_viewer": "Viewer",

  // --- rbac ---
  "settings.rbac.title": "Roles & Permissions (RBAC)",
  "settings.rbac.subtitle":
    "Role-based access control. The UI hides/locks actions the current role isn't permitted.",
  "settings.rbac.enforce_title": "Enable permission enforcement",
  "settings.rbac.enforce_desc":
    "When off, all actions are allowed (convenient for solo dev). When on, the UI follows the role below.",
  "settings.rbac.enforce_on": "Enforcing",
  "settings.rbac.enforce_off": "Off (full access)",
  "settings.rbac.session_role": "Current session role",
  "settings.rbac.active_chip": "Active",
  "settings.rbac.matrix_title": "Permission matrix — role",
  "settings.rbac.col_object": "Object",
  "settings.rbac.note":
    "Note: this is client-side RBAC (UI blocking). In production multi-user deployments, roles need to be re-validated at the backend/bridge.",
  "settings.rbac.obj_entity": "Entity",
  "settings.rbac.obj_page": "Page",
  "settings.rbac.obj_workflow": "Workflow",
  "settings.rbac.obj_agent": "Agent",
  "settings.rbac.obj_activity": "Activity",
  "settings.rbac.obj_knowledge": "Knowledge",
  "settings.rbac.obj_iot": "IoT",
  "settings.rbac.obj_settings": "Settings",
  "settings.rbac.obj_rbac": "Roles",
  "settings.rbac.action_view": "View",
  "settings.rbac.action_create": "Create",
  "settings.rbac.action_edit": "Edit",
  "settings.rbac.action_delete": "Delete",
  "settings.rbac.action_run": "Run",

  // --- agents ---
  "settings.agents.title": "My Agents",
  "settings.agents.subtitle":
    "Set your primary agent to work with and manage agents you're a member of. When not set, the app still works — Topbar/AgentPanel will default to the company's CEO agent.",
  "settings.agents.primary_label": "Primary agent",
  "settings.agents.primary_unset":
    "Not set — app uses the company CEO as default assistant.",
  "settings.agents.open_btn": "Open",
  "settings.agents.change_btn": "Change",
  "settings.agents.deselect_btn": "Deselect",
  "settings.agents.pick_btn": "Choose primary agent",
  "settings.agents.my_agents_title": "Agents I manage ({count})",
  "settings.agents.sidebar_hint": "Open each agent via Sidebar →",
  "settings.agents.empty_title": "You haven't been assigned as a member of any agent",
  "settings.agents.empty_hint":
    "When you create a new agent, you automatically become the owner. Ask an admin to add you to existing agents.",
  "settings.agents.role_note":
    'Permissions: owner = full access + manage members + delete; operator = chat + edit config; observer = view only + chat. Can change/remove at the agent\'s "Members" tab (owner only).',
  "settings.agents.primary_chip": "primary",

  // --- backup ---
  "settings.backup.title": "Google Drive Backup",
  "settings.backup.subtitle":
    "PostgreSQL dump + sync /data/uploads directory to a Google Drive folder you choose. Files sync incrementally (unchanged files not re-uploaded).",
  "settings.backup.config_title": "Configuration",
  "settings.backup.guide_title": "Guide: Sign in to Google Drive (web) & get Folder ID",
  "settings.backup.guide_open": "Open",
  "settings.backup.guide_close": "Close",
  "settings.backup.key_label": "Service account JSON key",
  "settings.backup.key_hint_has": "Key already set — only fill in if you want to replace it.",
  "settings.backup.key_hint_no":
    "Paste the full JSON file contents (from GCP → Service Accounts → Keys).",
  "settings.backup.folder_label": "Google Drive Folder ID",
  "settings.backup.folder_hint":
    "The part after /folders/ in the Drive URL. Must share Editor access to the service account email.",
  "settings.backup.cron_label": "Automatic schedule (cron)",
  "settings.backup.cron_hint": "Leave blank = only run manually when clicking Backup now.",
  "settings.backup.cron_off": "Off",
  "settings.backup.test_btn": "Test connection",
  "settings.backup.save_btn": "Save config",
  "settings.backup.run_btn": "Backup now",
  "settings.backup.history_title": "Backup history",
  "settings.backup.history_empty": "No backups yet.",
  "settings.backup.save_ok": "Configuration saved.",
  "settings.backup.run_ok": "Backup job queued.",

  // --- embedding ---
  "settings.embedding.title": "Embedding Configuration",
  "settings.embedding.subtitle":
    "Embedding profile for the Knowledge Base. Fixed 768-dimension vectors — choose a model that returns this exact dimension.",
  "settings.embedding.provider_label": "Provider",
  "settings.embedding.model_label": "Model",
  "settings.embedding.endpoint_label": "Endpoint",
  "settings.embedding.endpoint_hint_ollama": "Leave blank to use http://localhost:11434",
  "settings.embedding.endpoint_hint_openai":
    "Leave blank to use https://api.openai.com. Gemini: enter OpenAI-compat URL.",
  "settings.embedding.apikey_label": "API Key",
  "settings.embedding.apikey_hint": "AES-256-GCM encrypted before saving to DB",
  "settings.embedding.save_btn": "Save config",
  "settings.embedding.save_ok": "Embedding configuration saved.",

  // --- plugins ---
  "settings.plugins.title": "Plugins",
  "settings.plugins.subtitle":
    "Register plugins by manifest, enable/disable at runtime without rebuilding, and export manifests for sharing between deployments.",
  "settings.plugins.registered_title": "Registered plugins",
  "settings.plugins.empty": "No plugins yet.",
  "settings.plugins.enabled_chip": "On",
  "settings.plugins.disabled_chip": "Off",
  "settings.plugins.export_btn": "Export",
  "settings.plugins.exported_ok": '✓ Exported manifest "{name}".',
  "settings.plugins.remove_confirm": 'Remove plugin "{name}"?',
  "settings.plugins.remove_title": "Remove plugin",
  "settings.plugins.remove_confirm_btn": "Remove",
  "settings.plugins.removed_ok": "✓ Plugin removed.",
  "settings.plugins.register_title": "Register / import plugin",
  "settings.plugins.name_ph": "Plugin name",
  "settings.plugins.version_ph": "Version",
  "settings.plugins.manifest_ph": "Manifest (JSON)",
  "settings.plugins.register_btn": "Register plugin",
  "settings.plugins.register_ok": "✓ Plugin registered.",
  "settings.plugins.register_hint":
    "Re-registering with the same name = update. Enable/disable applies immediately without rebuilding.",
  "settings.plugins.toggle_ok": "✓ Updated.",
  "settings.plugins.invalid_json": "Manifest is not valid JSON",

  // --- transfer ---
  "settings.transfer.title": "Export / Import Configuration",
  "settings.transfer.subtitle":
    'Package all entities, pages, workflows, agents into a JSON file — for backup or sharing an "ERP template". (Record data and plugins are not included.)',
  "settings.transfer.export_title": "Export configuration",
  "settings.transfer.export_desc":
    "Download a JSON file containing all current low-code objects.",
  "settings.transfer.export_btn": "Download config bundle",
  "settings.transfer.export_ok": "✓ Config bundle downloaded.",
  "settings.transfer.import_title": "Import configuration",
  "settings.transfer.import_desc":
    "Select an exported JSON file. Objects with matching ids will be overwritten.",
  "settings.transfer.import_btn": "Select file to import",
  "settings.transfer.import_confirm":
    "Importing will overwrite objects with matching ids. Continue?",
  "settings.transfer.import_confirm_title": "Import configuration",
  "settings.transfer.import_confirm_btn": "Import",
  "settings.transfer.import_ok":
    "✓ Imported: {entities} entities · {pages} pages · {workflows} workflows · {agents} agents.",
  "settings.transfer.import_error": "Import error:",
};
