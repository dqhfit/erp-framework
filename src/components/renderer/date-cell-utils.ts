/* Date helpers cho ô sửa inline / hiển thị ngày trong renderer.
   Date-only "YYYY-MM-DD" dựng LOCAL (tránh lệch ±1 ngày tz≠0 — bài học #9).
   Tách từ ConsumerPage.tsx. */

export const pad2 = (n: number) => String(n).padStart(2, "0");
/** Parse an toàn: chuỗi date-only "YYYY-MM-DD" dựng LOCAL (new Date(str) parse
 *  UTC → lệch ±1 ngày ở tz≠0 — bài học #9). Có giờ → parse bình thường. */
export function parseDateSafe(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
}
export function fmtDateCell(v: string, withTime: boolean): string {
  if (!v) return "";
  const d = parseDateSafe(v);
  if (Number.isNaN(d.getTime())) return v;
  const s = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${s} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : s;
}
export function toDateInput(v: string, withTime: boolean): string {
  if (!v) return "";
  const d = parseDateSafe(v);
  if (Number.isNaN(d.getTime())) return "";
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return withTime ? `${ymd}T${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ymd;
}
export function fromDateInput(v: string, withTime: boolean): string {
  if (!v) return "";
  if (!withTime) return v; // date: input đã là YYYY-MM-DD (validate slice 0..10)
  const d = new Date(v); // datetime-local (giờ địa phương) → ISO UTC
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}
