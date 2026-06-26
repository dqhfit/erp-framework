/* ==========================================================
   text-utils — tiện ích chuỗi dùng chung cho tìm kiếm/so khớp.
   ========================================================== */

/**
 * Bỏ dấu tiếng Việt + lowercase để so khớp tìm kiếm không phân biệt
 * hoa/thường và có/không dấu (đ→d). Dùng cho mọi combobox lọc client.
 *
 * ⚠ Trả chuỗi đã chuẩn-hoá — với danh sách lớn, precompute 1 lần/option
 *   (không gọi lại mỗi phím gõ trên từng option).
 */
export function normalizeVi(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
}
