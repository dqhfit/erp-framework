/* ==========================================================
   Markdown — renderer Markdown nhẹ, KHÔNG phụ thuộc thư viện
   ngoài (giữ bundle nhỏ, đồng bộ phong cách repo: tự cài thay vì
   thêm dep như useFocusTrap / Icons).

   Hỗ trợ: heading (dấu thăng), in đậm, in nghiêng, code inline,
   code block (ba dấu huyền), danh sách (gạch đầu dòng / đánh số),
   blockquote, đường kẻ ngang, link, và BẢNG GFM (dạng a | b).

   An toàn XSS: dựng thẳng React element (React tự escape text),
   KHÔNG dùng dangerouslySetInnerHTML. Link chỉ cho http/https/
   mailto — chặn javascript:.
   ========================================================== */
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Chỉ cho phép scheme an toàn; còn lại trả "#" (vô hại). */
function safeHref(url: string): string {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:|\/)/i.test(u)) return u;
  return "#";
}

/* ── Inline: đậm / nghiêng / code / link ── */
const INLINE_PATTERNS: {
  re: RegExp;
  node: (m: RegExpExecArray, key: number) => ReactNode;
}[] = [
  {
    re: /`([^`]+)`/,
    node: (m, key) => (
      <code
        key={key}
        className="px-1 py-0.5 rounded bg-bg-soft border border-border text-[0.85em] font-mono"
      >
        {m[1]}
      </code>
    ),
  },
  {
    re: /\*\*([^*]+)\*\*/,
    node: (m, key) => <strong key={key}>{parseInline(m[1] ?? "")}</strong>,
  },
  {
    re: /__([^_]+)__/,
    node: (m, key) => <strong key={key}>{parseInline(m[1] ?? "")}</strong>,
  },
  {
    re: /\*([^*\n]+)\*/,
    node: (m, key) => <em key={key}>{parseInline(m[1] ?? "")}</em>,
  },
  {
    re: /(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/,
    node: (m, key) => <em key={key}>{parseInline(m[1] ?? "")}</em>,
  },
  {
    re: /\[([^\]]+)\]\(([^)]+)\)/,
    node: (m, key) => (
      <a
        key={key}
        href={safeHref(m[2] ?? "")}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent underline hover:no-underline"
      >
        {m[1]}
      </a>
    ),
  },
];

/** Phân tích chuỗi inline → mảng ReactNode. Chọn token khớp SỚM nhất. */
function parseInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    let best: { idx: number; len: number; node: ReactNode } | null = null;
    for (const p of INLINE_PATTERNS) {
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.idx)) {
        best = { idx: m.index, len: m[0].length, node: p.node(m, key) };
      }
    }
    if (!best) {
      out.push(<Fragment key={key++}>{rest}</Fragment>);
      break;
    }
    if (best.idx > 0) out.push(<Fragment key={key++}>{rest.slice(0, best.idx)}</Fragment>);
    out.push(best.node);
    key++;
    rest = rest.slice(best.idx + best.len);
  }
  return out;
}

/* ── Bảng GFM ── */
function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}
function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");
}

/** Phân tích cả khối text → mảng block React. */
function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  // Truy cập dòng an toàn (noUncheckedIndexedAccess) — ngoài phạm vi → "".
  const at = (k: number): string => lines[k] ?? "";
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = at(i);

    // Dòng trống → bỏ qua
    if (!line.trim()) {
      i++;
      continue;
    }

    // Code block ```
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(at(i))) {
        body.push(at(i));
        i++;
      }
      i++; // bỏ dòng ``` đóng
      blocks.push(
        <pre
          key={key++}
          className="my-1.5 p-2 rounded-md bg-bg-soft border border-border overflow-x-auto text-[0.85em] font-mono leading-relaxed"
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Bảng: dòng có | + dòng kế là separator
    if (line.includes("|") && i + 1 < lines.length && isTableSep(at(i + 1))) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && at(i).includes("|") && at(i).trim()) {
        rows.push(splitRow(at(i)));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-1.5 overflow-x-auto">
          <table className="w-full border-collapse text-[0.9em]">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: cột bảng tĩnh theo thứ tự
                    key={hi}
                    className="border border-border px-2 py-1 text-left font-semibold bg-bg-soft"
                  >
                    {parseInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: hàng bảng tĩnh theo thứ tự
                <tr key={ri}>
                  {header.map((_, ci) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: ô bảng tĩnh theo thứ tự
                    <td key={ci} className="border border-border px-2 py-1 align-top">
                      {parseInline(r[ci] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = (h[1] ?? "").length;
      const sizes = ["text-base", "text-base", "text-sm", "text-sm", "text-xs", "text-xs"];
      blocks.push(
        <div key={key++} className={cn("font-semibold mt-2 mb-0.5", sizes[level - 1])}>
          {parseInline(h[2] ?? "")}
        </div>,
      );
      i++;
      continue;
    }

    // Đường kẻ ngang
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-2 border-border" />);
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(at(i))) {
        body.push(at(i).replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-1.5 pl-3 border-l-2 border-accent/40 text-muted italic"
        >
          {parseInline(body.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    // Danh sách (ul / ol) — gom các dòng liền kề cùng loại
    const ulItem = line.match(/^\s*[-*+]\s+(.*)$/);
    const olItem = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ulItem || olItem) {
      const ordered = !!olItem;
      const items: string[] = [];
      while (i < lines.length) {
        const um = at(i).match(/^\s*[-*+]\s+(.*)$/);
        const om = at(i).match(/^\s*\d+\.\s+(.*)$/);
        if (ordered && om) items.push(om[1] ?? "");
        else if (!ordered && um) items.push(um[1] ?? "");
        else break;
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={key++}
          className={cn("my-1.5 pl-5 space-y-0.5", ordered ? "list-decimal" : "list-disc")}
        >
          {items.map((it, ii) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: mục danh sách tĩnh theo thứ tự
            <li key={ii}>{parseInline(it)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // Đoạn văn — gom dòng liền nhau tới dòng trống / block khác
    const para: string[] = [];
    while (
      i < lines.length &&
      at(i).trim() &&
      !/^\s*```/.test(at(i)) &&
      !/^(#{1,6})\s+/.test(at(i)) &&
      !/^\s*>\s?/.test(at(i)) &&
      !/^\s*[-*+]\s+/.test(at(i)) &&
      !/^\s*\d+\.\s+/.test(at(i)) &&
      !(at(i).includes("|") && i + 1 < lines.length && isTableSep(at(i + 1)))
    ) {
      para.push(at(i));
      i++;
    }
    if (para.length) {
      blocks.push(
        <p key={key++} className="my-1 leading-relaxed wrap-break-word">
          {parseInline(para.join("\n"))}
        </p>,
      );
    }
  }
  return blocks;
}

interface MarkdownProps {
  text: string;
  className?: string;
}

/** Render Markdown thành UI. Dùng cho câu trả lời chatbot/LLM, tóm tắt AI… */
export function Markdown({ text, className }: MarkdownProps) {
  return (
    <div className={cn("text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      {parseBlocks(text)}
    </div>
  );
}
