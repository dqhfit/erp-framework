/* ==========================================================
   cron.ts — Parser cron 5 trường tối giản, đủ dùng cho lịch
   chạy workflow trong trình duyệt.
   Định dạng: "phút giờ ngày-tháng tháng thứ"
   Hỗ trợ mỗi trường: dấu sao, a, a-b, a,b,c, bước /n, range/n
   ========================================================== */

export interface CronFields {
  minute: number[]; // 0-59
  hour: number[]; // 0-23
  dom: number[]; // 1-31 (day of month)
  month: number[]; // 1-12
  dow: number[]; // 0-6  (0 = Chủ nhật)
}

const RANGES: Record<keyof CronFields, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 6],
};

/** Parse một trường cron thành mảng số. Ném lỗi nếu sai cú pháp. */
function parseField(raw: string, [lo, hi]: [number, number]): number[] {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!step || step < 1) throw new Error(`bước không hợp lệ: ${part}`);

    let start = lo;
    let end = hi;
    if (rangePart !== "*") {
      const m = (rangePart ?? "").split("-");
      start = Number.parseInt(m[0] ?? "", 10);
      end = m.length > 1 ? Number.parseInt(m[1] ?? "", 10) : start;
      if (Number.isNaN(start) || Number.isNaN(end))
        throw new Error(`giá trị không hợp lệ: ${part}`);
      // Nếu không có range mà có step (vd 5/10) → từ start đến hi
      if (m.length === 1 && stepPart) end = hi;
    }
    if (start < lo || end > hi || start > end) throw new Error(`ngoài khoảng: ${part}`);
    for (let v = start; v <= end; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Parse biểu thức cron. Trả null nếu lỗi. */
export function parseCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  // Sau split + check length === 5, từng phần tử chắc chắn có (tuple).
  const [m, h, dom, mo, dow] = parts as [string, string, string, string, string];
  try {
    return {
      minute: parseField(m, RANGES.minute),
      hour: parseField(h, RANGES.hour),
      dom: parseField(dom, RANGES.dom),
      month: parseField(mo, RANGES.month),
      dow: parseField(dow, RANGES.dow),
    };
  } catch {
    return null;
  }
}

/** Cron có khớp thời điểm `date` không (so tới phút). */
export function cronMatches(expr: string, date: Date): boolean {
  const f = parseCron(expr);
  if (!f) return false;
  return (
    f.minute.includes(date.getMinutes()) &&
    f.hour.includes(date.getHours()) &&
    f.dom.includes(date.getDate()) &&
    f.month.includes(date.getMonth() + 1) &&
    f.dow.includes(date.getDay())
  );
}

/** Tìm lần chạy kế tiếp kể từ `from` (quét tối đa ~366 ngày theo phút). */
export function nextCronRun(expr: string, from: Date = new Date()): Date | null {
  const f = parseCron(expr);
  if (!f) return null;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = 366 * 24 * 60; // phút
  for (let i = 0; i < limit; i++) {
    if (
      f.minute.includes(d.getMinutes()) &&
      f.hour.includes(d.getHours()) &&
      f.dom.includes(d.getDate()) &&
      f.month.includes(d.getMonth() + 1) &&
      f.dow.includes(d.getDay())
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/** Mô tả tiếng Việt gọn cho một số mẫu cron phổ biến. */
export function describeCron(expr: string): string {
  const f = parseCron(expr);
  if (!f) return "Biểu thức không hợp lệ";
  const e = expr.trim();
  const PRESETS: Record<string, string> = {
    "* * * * *": "Mỗi phút",
    "*/5 * * * *": "Mỗi 5 phút",
    "*/15 * * * *": "Mỗi 15 phút",
    "*/30 * * * *": "Mỗi 30 phút",
    "0 * * * *": "Mỗi giờ (đầu giờ)",
    "0 9 * * *": "Hằng ngày lúc 09:00",
    "0 0 * * *": "Hằng ngày lúc 00:00",
    "0 9 * * 1": "Mỗi thứ Hai lúc 09:00",
    "0 9 1 * *": "Ngày 1 hằng tháng lúc 09:00",
  };
  if (PRESETS[e]) return PRESETS[e];
  const next = nextCronRun(expr);
  return next ? `Tuỳ chỉnh — lần kế: ${next.toLocaleString("vi-VN")}` : "Tuỳ chỉnh";
}

/** Các preset cron sẵn cho UI. */
export const CRON_PRESETS: { expr: string; label: string }[] = [
  { expr: "*/5 * * * *", label: "Mỗi 5 phút" },
  { expr: "*/15 * * * *", label: "Mỗi 15 phút" },
  { expr: "*/30 * * * *", label: "Mỗi 30 phút" },
  { expr: "0 * * * *", label: "Mỗi giờ" },
  { expr: "0 9 * * *", label: "Hằng ngày 09:00" },
  { expr: "0 9 * * 1", label: "Thứ Hai 09:00" },
  { expr: "0 9 1 * *", label: "Ngày 1 hằng tháng 09:00" },
];
