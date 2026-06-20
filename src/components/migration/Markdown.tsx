/* Markdown preview tối giản (heading/quote/list/table/code + inline
 **bold** `code` [link](url)). Dùng cho mô tả lỗi/audit trong migration. */
import type { ReactElement } from "react";

export function MarkdownPreview({ text }: { text: string }) {
  const lines = text.split("\n");
  return <div className="space-y-1">{lines.map((line, i) => renderMdLine(line, i))}</div>;
}

function renderMdLine(line: string, key: number): ReactElement {
  if (line.startsWith("# ")) {
    return (
      <h1 key={key} className="text-base font-bold mt-3">
        {inline(line.slice(2))}
      </h1>
    );
  }
  if (line.startsWith("## ")) {
    return (
      <h2 key={key} className="text-sm font-semibold mt-2">
        {inline(line.slice(3))}
      </h2>
    );
  }
  if (line.startsWith("### ")) {
    return (
      <h3 key={key} className="text-[13px] font-semibold mt-2">
        {inline(line.slice(4))}
      </h3>
    );
  }
  if (line.startsWith("> ")) {
    return (
      <blockquote key={key} className="border-l-2 border-accent pl-2 text-muted">
        {inline(line.slice(2))}
      </blockquote>
    );
  }
  if (/^[-*] /.test(line)) {
    return (
      <div key={key} className="ml-3">
        • {inline(line.slice(2))}
      </div>
    );
  }
  if (line.startsWith("|")) {
    // Table row — render đơn giản dưới dạng pipe-separated.
    return (
      <div key={key} className="font-mono text-[10px] text-muted">
        {line}
      </div>
    );
  }
  if (line.trim() === "") return <div key={key} className="h-2" />;
  if (line.startsWith("```")) {
    return (
      <div key={key} className="font-mono text-[10px] text-muted">
        {line}
      </div>
    );
  }
  return <div key={key}>{inline(line)}</div>;
}

/** Inline parse: **bold**, `code`, [link](url). */
function inline(text: string): ReactElement {
  // Tokenize: dùng regex chia thành parts.
  const parts: ReactElement[] = [];
  const i = 0;
  let keyN = 0;
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    if (m.index > lastIndex) {
      parts.push(<span key={keyN++}>{text.slice(lastIndex, m.index)}</span>);
    }
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={keyN++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={keyN++} className="bg-bg px-1 rounded text-accent">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      const linkM = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkM) {
        parts.push(
          <a key={keyN++} href={linkM[2]} className="text-accent hover:underline">
            {linkM[1]}
          </a>,
        );
      }
    }
    lastIndex = m.index + tok.length;
    m = re.exec(text);
  }
  if (lastIndex < text.length) {
    parts.push(<span key={keyN++}>{text.slice(lastIndex)}</span>);
  }
  void i;
  return <>{parts}</>;
}
