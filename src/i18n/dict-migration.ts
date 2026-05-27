/* ==========================================================
   dict-migration.ts — Key i18n cho trang Settings > Migration
   và component TagBox (generic multi-select).
   Tách riêng để dict.ts không phình.
   ========================================================== */
type Dict = Record<string, string>;

export const migrationVi: Dict = {
  // --- tagbox (generic multi-select component) ---
  "tagbox.placeholder": "Gõ để thêm, Enter để chọn...",
  "tagbox.picker_title": "Chọn từ danh sách",
  "tagbox.add_custom": '+ Thêm "{value}" (tự nhập)',
  "tagbox.remove_tag": "Xóa {tag}",
  "tagbox.open_picker_title": "Mở bộ chọn (tích hàng loạt)",
  "tagbox.open_picker": "Mở bộ chọn",
  "tagbox.filter_ph": "Lọc theo tên...",
  "tagbox.deselect_filtered": "Bỏ chọn (lọc hiện tại)",
  "tagbox.select_all_filtered": "Chọn tất cả (lọc hiện tại)",
  "tagbox.clear_all": "Xóa toàn bộ",
  "tagbox.selected_count": "{count} đã chọn",
  "tagbox.no_results": "Không có kết quả",
  "tagbox.btn_apply": "Áp dụng ({count})",

  // --- migration: permission / empty states ---
  "mig.no_permission": "Không có quyền",
  "mig.no_permission_hint": "Migration là công cụ admin — chỉ role admin mới xem được.",
  "mig.select_module": "Chọn một module",
  "mig.select_module_hint": "Hoặc dùng form bên trái để tạo module mới qua khám phá.",

  // --- migration: module list ---
  "mig.modules_heading": "Modules",
  "mig.btn_new": "Mới",
  "mig.no_modules": 'Chưa có module nào. Bấm "Mới" để tạo.',
  "mig.module_tables": "{count} bảng",
  "mig.module_procs": "{count} proc",

  // --- migration: env banner ---
  "mig.env_no_conn": "Chưa có kết nối MSSQL",
  "mig.env_no_default": "Chưa có kết nối mặc định",
  "mig.env_no_modules_dir": "Thiếu thư mục migration-plan/modules/",

  // --- migration: create module form ---
  "mig.form_module_name": "Tên module (snake_case)",
  "mig.form_seed_tables": "Bảng khởi tạo (chọn từ {count} bảng)",
  "mig.ph_filter_table": "Gõ tên bảng để lọc, Enter để chọn...",
  "mig.form_exclude": "Loại trừ (tuỳ chọn)",
  "mig.ph_exclude_table": "Bảng không được BFS lan vào...",
  "mig.btn_run_discover": "Tạo + chạy khám phá",
  "mig.btn_running_discover": "Đang chạy khám phá...",
  "mig.need_conn_hint": "Cần thêm và đặt mặc định 1 kết nối MSSQL trước.",

  // --- migration: tabs ---
  "mig.tab_discover": "1. Khám phá",
  "mig.tab_enrich": "2. Làm giàu (AI)",
  "mig.tab_capture": "3. Ghi mẫu",
  "mig.tab_generate": "4. Sinh code",
  "mig.tab_data": "5. Đồng bộ dữ liệu",
  "mig.tab_review": "Xem xét",
  "mig.tab_audit": "6. Kiểm tra",
  "mig.tab_generate_hint": "Tầng 2 (sinh code AI) — chưa triển khai",
  "mig.tab_audit_hint": "Tầng 4 (kiểm tra AI) — chưa triển khai",

  // --- migration: module detail header ---
  "mig.module_header": "{tables} bảng, {procs} proc",

  // --- migration: discover tab ---
  "mig.manifest_summary": "Tóm tắt manifest",
  "mig.tables_label": "Bảng ({count})",
  "mig.procs_label": "Proc ({count})",
  "mig.tables_more": "… +{count} bảng khác",
  "mig.procs_more": "… +{count} proc khác",
  "mig.discover_seed_label": "Bảng khởi tạo (chạy lại để mở rộng) — {count} bảng trong kết nối",
  "mig.ph_seed_bfs": "Chọn bảng khởi tạo để BFS lan...",
  "mig.discover_exclude": "Bảng loại trừ",
  "mig.cross_module_edges": "⚠ {count} liên kết liên module — cần thiết kế giao tiếp.",

  // --- migration: enrich tab ---
  "mig.enrich_apply_label": "Áp dụng (ghi đè manifest gốc)",
  "mig.enrich_overwrite": "Ghi đè",
  "mig.enrich_dry_run": "Chạy thử (sinh .enriched.yaml để so sánh)",
  "mig.enrich_max_cost": "Chi phí tối đa (USD)",
  "mig.enrich_diff_title": "So sánh (main vs enriched)",
  "mig.enrich_main_label": "Gốc (.yaml)",
  "mig.enrich_enriched_label": "Đã làm giàu (.enriched.yaml)",
  "mig.ai_log_title": "Nhật ký AI ({count} lần gọi)",
  "mig.ai_log_more": "… +{count} lần gọi khác",

  // --- migration: capture tab ---
  "mig.capture_title": "Ghi mẫu kết quả chuẩn",
  "mig.capture_desc":
    "Gọi stored procedure MSSQL với dữ liệu mẫu, lưu kết quả chuẩn vào e2e/golden/<module>/. Kết nối của công ty cần bật 'Cho phép ghi'.",
  "mig.capture_samples": "Số mẫu / proc",
  "mig.capture_procs_filter": "Lọc proc (để trống = tất cả)",

  // --- migration: data tab ---
  "mig.data_title": "Đồng bộ dữ liệu",
  "mig.data_desc":
    "Đọc hàng loạt bảng MSSQL → upsert vào entity_records. Chạy sau khi làm giàu + sinh code.",
  "mig.data_tables_filter": "Bảng (để trống = đồng bộ toàn bộ)",
  "mig.data_limit": "Giới hạn / bảng",

  // --- migration: disabled tabs ---
  "mig.generate_title": "Sinh code",
  "mig.audit_title": "Kiểm tra",
  "mig.generate_reason":
    "Tầng 2 (sinh code AI) chưa triển khai. Khi xong sẽ sinh thủ tục JS + plugin TS + trang mẫu từ manifest đã làm giàu.",
  "mig.audit_reason":
    "Tầng 4 (kiểm tra AI) chưa triển khai. Khi xong sẽ sinh danh sách kiểm tra Markdown các điểm hoàn thiện (RBAC, index, validate...).",

  // --- migration: job runner ---
  "mig.job_running": "Đang chạy...",
  "mig.job_run": "Chạy {action}",
  "mig.no_default_conn_hint": "Chưa có kết nối MSSQL mặc định — thêm ở bảng điều khiển bên trên.",

  // --- migration: diagram tab ---
  "mig.tab_diagram": "Sơ đồ quan hệ",
  "mig.diagram_loading": "Đang tải sơ đồ...",
  "mig.diagram_empty_title": "Chưa có bảng nào",
  "mig.diagram_empty_hint": "Chạy Discover trước để có manifest.",
  "mig.diagram_stats": "{tables} bảng · {entities} entity · {enums} enum · {edges} liên kết",
  "mig.diagram_node_values": "{count} giá trị",
  "mig.diagram_node_columns": "{count} cột",
  "mig.diagram_click_hint": "Bấm 1 node trong sơ đồ để xem chi tiết + sửa.",
  "mig.diagram_total": "Tổng: {total} bảng ({entities} entity · {enums} enum)",
  "mig.diagram_rename_entity": "Đổi tên entity",
  "mig.diagram_rename_cascade":
    'Cascade: các cột FK ở bảng khác trỏ tới "{name}" sẽ tự update relationEntity.',
  "mig.diagram_change_kind": "Đổi kind",
  "mig.diagram_kind_cascade_enum": "Cascade: cột FK trỏ tới đổi entityType relation → enum.",
  "mig.diagram_kind_cascade_entity": "Cascade: cột FK trỏ tới đổi entityType enum → relation.",
  "mig.diagram_applied": "✓ Đã áp dụng:",

  // --- migration: normalize names ---
  "mig.normalize_btn": "AI normalize names",
  "mig.normalize_busy": "AI đang phân tích...",
  "mig.normalize_modal_title": "AI suggest rename — chuẩn hóa naming",
  "mig.normalize_llm_fail": "LLM thất bại:",
  "mig.normalize_ok": "✓ AI không phát hiện naming không nhất quán — module đã chuẩn.",
  "mig.normalize_count": "{count} đề xuất",
  "mig.normalize_select_all": "Chọn tất cả",
  "mig.normalize_deselect": "Bỏ chọn",
  "mig.normalize_selected": "{count} đã chọn",
  "mig.normalize_col_kind": "Kind",
  "mig.normalize_col_current": "Hiện tại",
  "mig.normalize_col_suggested": "Đề xuất",
  "mig.normalize_col_reason": "Lý do",
  "mig.normalize_col_sev": "Sev",
  "mig.normalize_results": "Kết quả áp dụng:",
  "mig.normalize_applying": "Đang áp dụng...",
  "mig.normalize_apply_btn": "Áp dụng {count} rename",

  // --- migration: connections panel ---
  "mig.conn_panel_title": "Kết nối MSSQL",
  "mig.no_conn": 'Chưa có kết nối. Bấm "Thêm" để thêm mới.',
  "mig.chip_default": "Mặc định",
  "mig.btn_set_default": "Đặt mặc định",
  "mig.btn_delete": "Xóa",
  "mig.btn_test_conn": "Kiểm tra",
  "mig.test_ok": "✓ {count} bảng",
  "mig.test_err": "✗ Lỗi",
  "mig.delete_conn_confirm": 'Xóa kết nối "{name}"?',

  // --- migration: connection form ---
  "mig.conn_form_add": "Thêm kết nối mới",
  "mig.conn_form_edit": 'Sửa "{name}"',
  "mig.conn_field_name": "Tên",
  "mig.conn_field_db": "Cơ sở dữ liệu",
  "mig.conn_field_host": "Máy chủ",
  "mig.conn_field_host_ph": "10.0.0.5 hoặc sqlserver.local",
  "mig.conn_field_port": "Cổng",
  "mig.conn_field_user": "Tên đăng nhập",
  "mig.conn_field_pwd": "Mật khẩu",
  "mig.conn_field_pwd_keep": "Mật khẩu (để trống = giữ)",
  "mig.conn_field_pwd_keep_ph": "(giữ mật khẩu cũ)",
  "mig.conn_encrypt": "Mã hóa TLS",
  "mig.conn_trust_cert": "Tin tưởng chứng chỉ máy chủ",
  "mig.conn_allow_write": "Cho phép ghi (execProc)",
  "mig.conn_is_default": "Mặc định",
  "mig.btn_saving": "Đang lưu...",
};

export const migrationEn: Dict = {
  // --- tagbox ---
  "tagbox.placeholder": "Type to add, Enter to select...",
  "tagbox.picker_title": "Select from list",
  "tagbox.add_custom": '+ Add "{value}" (custom)',
  "tagbox.remove_tag": "Remove {tag}",
  "tagbox.open_picker_title": "Open picker (batch select)",
  "tagbox.open_picker": "Open picker",
  "tagbox.filter_ph": "Filter by name...",
  "tagbox.deselect_filtered": "Deselect (current filter)",
  "tagbox.select_all_filtered": "Select all (current filter)",
  "tagbox.clear_all": "Clear all",
  "tagbox.selected_count": "{count} selected",
  "tagbox.no_results": "No results",
  "tagbox.btn_apply": "Apply ({count})",

  // --- migration: permission / empty states ---
  "mig.no_permission": "No permission",
  "mig.no_permission_hint": "Migration is an admin tool — only admin role can view.",
  "mig.select_module": "Select a module",
  "mig.select_module_hint": "Or use the form on the left to create a new module via discover.",

  // --- migration: module list ---
  "mig.modules_heading": "Modules",
  "mig.btn_new": "New",
  "mig.no_modules": 'No modules yet. Click "New" to create one.',
  "mig.module_tables": "{count} tables",
  "mig.module_procs": "{count} procs",

  // --- migration: env banner ---
  "mig.env_no_conn": "No MSSQL connection",
  "mig.env_no_default": "No default connection",
  "mig.env_no_modules_dir": "Missing migration-plan/modules/ directory",

  // --- migration: create module form ---
  "mig.form_module_name": "Module name (snake_case)",
  "mig.form_seed_tables": "Seed tables (select from {count} tables)",
  "mig.ph_filter_table": "Type table name to filter, Enter to select...",
  "mig.form_exclude": "Exclude (optional)",
  "mig.ph_exclude_table": "Tables to exclude from BFS...",
  "mig.btn_run_discover": "Create + run discover",
  "mig.btn_running_discover": "Running discover...",
  "mig.need_conn_hint": "Add and set a default MSSQL connection first.",

  // --- migration: tabs ---
  "mig.tab_discover": "1. Discover",
  "mig.tab_enrich": "2. Enrich (AI)",
  "mig.tab_capture": "3. Capture",
  "mig.tab_generate": "4. Generate",
  "mig.tab_data": "5. Data ETL",
  "mig.tab_review": "Review",
  "mig.tab_audit": "6. Audit",
  "mig.tab_generate_hint": "Tier 2 (AI codegen) — not implemented",
  "mig.tab_audit_hint": "Tier 4 (AI audit) — not implemented",

  // --- migration: module detail header ---
  "mig.module_header": "{tables} tables, {procs} procs",

  // --- migration: discover tab ---
  "mig.manifest_summary": "Manifest summary",
  "mig.tables_label": "Tables ({count})",
  "mig.procs_label": "Procs ({count})",
  "mig.tables_more": "… +{count} more tables",
  "mig.procs_more": "… +{count} more procs",
  "mig.discover_seed_label": "Seed tables (re-run to expand) — {count} tables in connection",
  "mig.ph_seed_bfs": "Select seed tables for BFS traversal...",
  "mig.discover_exclude": "Exclude tables",
  "mig.cross_module_edges": "⚠ {count} cross-module edges — contract design needed.",

  // --- migration: enrich tab ---
  "mig.enrich_apply_label": "Apply (overwrite main manifest)",
  "mig.enrich_overwrite": "Overwrite",
  "mig.enrich_dry_run": "Dry-run (generate .enriched.yaml for diff)",
  "mig.enrich_max_cost": "Max cost (USD)",
  "mig.enrich_diff_title": "Diff (main vs enriched)",
  "mig.enrich_main_label": "Main (.yaml)",
  "mig.enrich_enriched_label": "Enriched (.enriched.yaml)",
  "mig.ai_log_title": "AI log ({count} calls)",
  "mig.ai_log_more": "… +{count} more calls",

  // --- migration: capture tab ---
  "mig.capture_title": "Capture golden output",
  "mig.capture_desc":
    "Call MSSQL stored procs with sample input, save baseline output to e2e/golden/<module>/. Connection must have 'Allow write' enabled.",
  "mig.capture_samples": "Samples / proc",
  "mig.capture_procs_filter": "Filter procs (empty = all)",

  // --- migration: data tab ---
  "mig.data_title": "ETL data",
  "mig.data_desc":
    "BulkRead MSSQL tables → upsert into entity_records. Run after enrich + generate.",
  "mig.data_tables_filter": "Tables (empty = ETL all)",
  "mig.data_limit": "Limit / table",

  // --- migration: disabled tabs ---
  "mig.generate_title": "Generate",
  "mig.audit_title": "Audit",
  "mig.generate_reason":
    "Tier 2 (AI codegen) not implemented. When done, will generate procedure JS + plugin TS + sample pages from enriched manifest.",
  "mig.audit_reason":
    "Tier 4 (AI audit) not implemented. When done, will generate a Markdown checklist of completion points (RBAC, index, validate...).",

  // --- migration: job runner ---
  "mig.job_running": "Running...",
  "mig.job_run": "Run {action}",
  "mig.no_default_conn_hint": "No default MSSQL connection — add one in the panel above.",

  // --- migration: diagram tab ---
  "mig.tab_diagram": "Relationship Diagram",
  "mig.diagram_loading": "Loading diagram...",
  "mig.diagram_empty_title": "No tables yet",
  "mig.diagram_empty_hint": "Run Discover first to build the manifest.",
  "mig.diagram_stats": "{tables} tables · {entities} entities · {enums} enums · {edges} edges",
  "mig.diagram_node_values": "{count} values",
  "mig.diagram_node_columns": "{count} columns",
  "mig.diagram_click_hint": "Click a node in the diagram to view details and edit.",
  "mig.diagram_total": "Total: {total} tables ({entities} entities · {enums} enums)",
  "mig.diagram_rename_entity": "Rename entity",
  "mig.diagram_rename_cascade":
    'Cascade: FK columns in other tables pointing to "{name}" will auto-update relationEntity.',
  "mig.diagram_change_kind": "Change kind",
  "mig.diagram_kind_cascade_enum": "Cascade: FK columns will change entityType relation → enum.",
  "mig.diagram_kind_cascade_entity": "Cascade: FK columns will change entityType enum → relation.",
  "mig.diagram_applied": "✓ Applied:",

  // --- migration: normalize names ---
  "mig.normalize_btn": "AI normalize names",
  "mig.normalize_busy": "AI analyzing...",
  "mig.normalize_modal_title": "AI suggest rename — normalize naming",
  "mig.normalize_llm_fail": "LLM failed:",
  "mig.normalize_ok": "✓ AI found no naming inconsistencies — module looks good.",
  "mig.normalize_count": "{count} suggestions",
  "mig.normalize_select_all": "Select all",
  "mig.normalize_deselect": "Deselect all",
  "mig.normalize_selected": "{count} selected",
  "mig.normalize_col_kind": "Kind",
  "mig.normalize_col_current": "Current",
  "mig.normalize_col_suggested": "Suggested",
  "mig.normalize_col_reason": "Reason",
  "mig.normalize_col_sev": "Sev",
  "mig.normalize_results": "Applied results:",
  "mig.normalize_applying": "Applying...",
  "mig.normalize_apply_btn": "Apply {count} renames",

  // --- migration: connections panel ---
  "mig.conn_panel_title": "MSSQL Connections",
  "mig.no_conn": 'No connections. Click "Add" to add one.',
  "mig.chip_default": "Default",
  "mig.btn_set_default": "Set default",
  "mig.btn_delete": "Delete",
  "mig.btn_test_conn": "Test",
  "mig.test_ok": "✓ {count} tables",
  "mig.test_err": "✗ Error",
  "mig.delete_conn_confirm": 'Delete connection "{name}"?',

  // --- migration: connection form ---
  "mig.conn_form_add": "Add new connection",
  "mig.conn_form_edit": 'Edit "{name}"',
  "mig.conn_field_name": "Name",
  "mig.conn_field_db": "Database",
  "mig.conn_field_host": "Host",
  "mig.conn_field_host_ph": "10.0.0.5 or sqlserver.local",
  "mig.conn_field_port": "Port",
  "mig.conn_field_user": "Username",
  "mig.conn_field_pwd": "Password",
  "mig.conn_field_pwd_keep": "Password (leave blank to keep)",
  "mig.conn_field_pwd_keep_ph": "(keep existing password)",
  "mig.conn_encrypt": "Encrypt TLS",
  "mig.conn_trust_cert": "Trust server cert",
  "mig.conn_allow_write": "Allow write (execProc)",
  "mig.conn_is_default": "Default",
  "mig.btn_saving": "Saving...",
};
