/* ==========================================================
   dict-approvals.ts — Key i18n cho trang Phe duyet
   (approvals.tsx). Tach rieng de dict.ts khong phinh.
   ========================================================== */
type Dict = Record<string, string>;

export const approvalsVi: Dict = {
  "approvals.title": "Phê duyệt (Governance)",
  "approvals.subtitle":
    'Yêu cầu phê duyệt nhiều tầng — cần đủ số người duyệt mới chuyển sang "approved"; một người từ chối là "rejected".',
  "approvals.create_title": "Tạo yêu cầu phê duyệt",
  "approvals.title_input": "Tiêu đề",
  "approvals.detail_input": "Chi tiết (tuỳ chọn)",
  "approvals.required_label": "Số tầng duyệt cần đạt:",
  "approvals.create_btn": "Tạo yêu cầu",
  "approvals.pending_title": "Chờ duyệt ({count})",
  "approvals.pending_empty": "Không có yêu cầu nào chờ duyệt.",
  "approvals.done_title": "Đã quyết định ({count})",
  "approvals.approved_count": "Đã duyệt {approved}/{required} · {decisions} quyết định",
  "approvals.approve_btn": "Duyệt",
  "approvals.reject_btn": "Từ chối",
};

export const approvalsEn: Dict = {
  "approvals.title": "Approvals (Governance)",
  "approvals.subtitle":
    'Multi-level approval requests — needs enough approvers before becoming "approved"; one rejection means "rejected".',
  "approvals.create_title": "Create approval request",
  "approvals.title_input": "Title",
  "approvals.detail_input": "Details (optional)",
  "approvals.required_label": "Required approvals:",
  "approvals.create_btn": "Create request",
  "approvals.pending_title": "Pending ({count})",
  "approvals.pending_empty": "No pending requests.",
  "approvals.done_title": "Decided ({count})",
  "approvals.approved_count": "Approved {approved}/{required} · {decisions} decisions",
  "approvals.approve_btn": "Approve",
  "approvals.reject_btn": "Reject",
};
