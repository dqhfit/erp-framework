/* ==========================================================
   format.ts — Hàm định dạng hiển thị dùng chung (tiền tệ, số…).
   Tách khỏi object-types.ts để tên file phản ánh đúng nội dung.
   ========================================================== */

/** Định dạng số thành tiền VND, vd 84500000 → "84.500.000 ₫". */
export function formatVND(n: number): string {
  return `${n.toLocaleString("vi-VN")} ₫`;
}
