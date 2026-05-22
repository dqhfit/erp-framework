/* ==========================================================
   chunk.ts — Cắt văn bản thành đoạn (chunk) cho Knowledge Base.
   Tách theo đoạn văn (dòng trống), gộp tới ~MAX_CHARS ký tự, giữ
   chồng lấp ~OVERLAP ký tự giữa các chunk để không mất ngữ cảnh ở
   ranh giới. Hàm thuần — không I/O, dễ unit test.
   ========================================================== */

export interface Chunk {
  seq: number;
  content: string;
  /** Ước lượng số token (~4 ký tự/token) — chỉ để tham khảo/hiển thị. */
  tokens: number;
}

const MAX_CHARS = 1000;
const OVERLAP = 150;

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** Cắt `text` thành các chunk. Trả về mảng rỗng nếu text rỗng. */
export function chunkText(text: string): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  // Tách theo đoạn văn; đoạn dài hơn MAX_CHARS tự cắt nhỏ cứng.
  const pieces: string[] = [];
  for (const para of clean.split(/\n\s*\n+/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= MAX_CHARS) {
      pieces.push(p);
    } else {
      for (let i = 0; i < p.length; i += MAX_CHARS) {
        pieces.push(p.slice(i, i + MAX_CHARS));
      }
    }
  }

  const chunks: Chunk[] = [];
  let buf = "";
  const flush = () => {
    const content = buf.trim();
    if (content) {
      chunks.push({ seq: chunks.length, content, tokens: estimateTokens(content) });
    }
  };
  for (const piece of pieces) {
    if (buf && buf.length + piece.length + 2 > MAX_CHARS) {
      flush();
      // Chồng lấp: mang theo OVERLAP ký tự cuối của chunk vừa xả.
      const tail = buf.length > OVERLAP ? buf.slice(-OVERLAP) : buf;
      buf = `${tail}\n\n${piece}`;
    } else {
      buf = buf ? `${buf}\n\n${piece}` : piece;
    }
  }
  flush();
  return chunks;
}
