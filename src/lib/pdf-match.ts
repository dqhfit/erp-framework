/* ==========================================================
   pdf-match.ts — Khớp text trang PDF với chi tiết (mã + tên + kích thước).
   TÁCH KHỎI pdf.ts (nặng, pdfjs) để import TĨNH được mà không kéo pdfjs vào
   bundle — chỉ là hàm thuần trên mảng text đã trích.
   ========================================================== */

/** Mô tả 1 chi tiết để nhận diện trang: mã + tên + các kích thước (dày/rộng/dài). */
export interface DetailInfo {
  mact?: string;
  chitiet?: string;
  dims?: Array<string | number | null | undefined>;
}

/** Ngưỡng coi là "khớp đáng tin" (mã khớp, hoặc đủ tên + kích thước). */
export const MATCH_CONFIDENT = 8;

const stripDiacritics = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Trang đầu tiên (1-based) có chứa `code` (mã chi tiết). null nếu không thấy. */
export function findPageByCode(pageTexts: string[], code: string): number | null {
  const c = String(code ?? "")
    .trim()
    .toLowerCase();
  if (!c) return null;
  for (let i = 0; i < pageTexts.length; i++) {
    if ((pageTexts[i] ?? "").toLowerCase().includes(c)) return i + 1;
  }
  return null;
}

/** Điểm khớp giữa text 1 trang và chi tiết: mã (mạnh) + token tên + kích thước. */
export function scorePageForDetail(pageText: string, d: DetailInfo): number {
  const t = (pageText ?? "").toLowerCase();
  if (!t) return 0;
  let s = 0;
  const mact = String(d.mact ?? "")
    .trim()
    .toLowerCase();
  if (mact && t.includes(mact)) s += 100; // mã chi tiết duy nhất → rất mạnh
  if (d.chitiet) {
    const toks = stripDiacritics(String(d.chitiet).toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
    const tn = stripDiacritics(t);
    for (const w of toks) if (tn.includes(w)) s += 5;
  }
  for (const dim of d.dims ?? []) {
    const n = String(dim ?? "").trim();
    if (n && Number(n) > 0 && new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(t)) s += 4;
  }
  return s;
}

/** Trang khớp NHẤT với chi tiết (1-based) + điểm. page=0 nếu không trang nào điểm>0. */
export function findBestPage(pageTexts: string[], d: DetailInfo): { page: number; score: number } {
  let best = { page: 0, score: 0 };
  for (let i = 0; i < pageTexts.length; i++) {
    const sc = scorePageForDetail(pageTexts[i] ?? "", d);
    if (sc > best.score) best = { page: i + 1, score: sc };
  }
  return best;
}
