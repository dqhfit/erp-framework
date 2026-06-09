/* ==========================================================
   SqlEditor — textarea SQL có GỢI Ý KHI GÕ (autocomplete) cho tab
   "SQL" của Nguồn dữ liệu. Context-aware theo catalog đối tượng:
     • sau FROM / JOIN        → tên đối tượng (entity)
     • sau `alias.`           → cột của đối tượng mà alias trỏ tới (+ *)
     • còn lại                → từ khoá SQL + hàm gom + alias đã khai báo
   Popup bám con trỏ (đo caret qua mirror-div copy computed style — chuẩn,
   không thêm dependency). Phím: ↑/↓ chọn · Enter/Tab chấp nhận · Esc đóng ·
   Ctrl/⌘+Space mở thủ công.

   CHỈ là trợ giúp soạn thảo — không đổi value ngoài việc chèn token.
   ========================================================== */

import { type DslEntity, indexEntitiesByName } from "@erp-framework/core";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Gợi ý 1 đối tượng: CHÈN tên kỹ thuật (ổn định), hiện nhãn ở cột phụ. */
function entitySug(e: DslEntity): Sug {
  const tech = e.techName?.trim() || e.name;
  return { label: tech, insert: tech, kind: "entity", detail: e.techName ? e.name : undefined };
}

interface SqlEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Catalog để gợi ý tên đối tượng + cột. */
  entities: DslEntity[];
  className?: string;
  placeholder?: string;
  /** Gọi khi "chạy" (Ctrl/⌘+Enter, F5, hoặc handle.run): SQL vùng chọn hoặc
   *  câu lệnh tại con trỏ (tách theo ';'), fallback toàn bộ. */
  onRun?: (sql: string, isSelection: boolean) => void;
}

/** Handle imperative để nút ngoài (panel) kích hoạt "chạy". */
export interface SqlEditorHandle {
  run: () => void;
}

type SugKind = "keyword" | "fn" | "entity" | "field" | "alias";
interface Sug {
  label: string;
  /** Token chèn vào (thay phần đang gõ). */
  insert: string;
  kind: SugKind;
  detail?: string;
}

/* Từ khoá SQL gợi ý (dạng hiển thị; chèn kèm khoảng trắng cho nhanh tay). */
const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "AS",
  "WHERE",
  "AND",
  "OR",
  "ORDER BY",
  "ASC",
  "DESC",
  "LEFT JOIN",
  "INNER JOIN",
  "JOIN",
  "ON",
  "GROUP BY",
  "HAVING",
  "LIMIT",
  "TOP",
  "OFFSET",
  "IN",
  "LIKE",
  "IS NULL",
  "DISTINCT",
];
const AGG_FNS = ["COUNT", "SUM", "AVG", "MIN", "MAX"];

/* Keyword chặn — khi đứng ở vị trí "alias" của FROM/JOIN nghĩa là KHÔNG có alias. */
const CLAUSE_KW = new Set([
  "ON",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "JOIN",
  "WHERE",
  "ORDER",
  "GROUP",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "AS",
  "AND",
  "OR",
]);

const badgeCls: Record<SugKind, string> = {
  keyword: "bg-accent/15 text-accent",
  fn: "bg-accent-2/15 text-accent-2",
  entity: "bg-success/15 text-success",
  field: "bg-bg-soft text-muted",
  alias: "bg-warning/15 text-warning",
};
const badgeText: Record<SugKind, string> = {
  keyword: "kw",
  fn: "fn",
  entity: "đối tượng",
  field: "cột",
  alias: "alias",
};

function unquote(s: string): string {
  return s.replace(/^[[""]|[\]""]$/g, "");
}

/** Map alias (lowercase) → tên entity, quét toàn câu (FROM/JOIN, +base, +tên gốc). */
function buildAliasMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /\b(from|join)\s+(\[[^\]]+\]|"[^"]+"|[A-Za-z0-9_]+)(?:\s+(?:as\s+)?(\[[^\]]+\]|"[^"]+"|[A-Za-z0-9_]+))?/gi;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    const kw = (m[1] as string).toLowerCase();
    const entity = unquote(m[2] as string);
    let alias = m[3] ? unquote(m[3]) : entity;
    if (CLAUSE_KW.has(alias.toUpperCase())) alias = entity; // group 3 thực ra là clause kw
    map.set(alias.toLowerCase(), entity);
    map.set(entity.toLowerCase(), entity); // cho phép `<tênGốc>.cột`
    if (kw === "from") map.set("base", entity);
    m = re.exec(text);
  }
  return map;
}

/* ─── Đo toạ độ caret trong textarea qua mirror div ─── */
const MIRROR_PROPS = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

function caretCoords(
  ta: HTMLTextAreaElement,
  pos: number,
): { top: number; left: number; height: number } {
  const doc = ta.ownerDocument;
  const div = doc.createElement("div");
  const style = div.style;
  const computed = getComputedStyle(ta);
  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  const cs = computed as unknown as Record<string, string>;
  const st = style as unknown as Record<string, string>;
  for (const p of MIRROR_PROPS) st[p] = cs[p] ?? "";
  div.textContent = ta.value.slice(0, pos);
  const span = doc.createElement("span");
  span.textContent = ta.value.slice(pos) || ".";
  div.appendChild(span);
  doc.body.appendChild(div);
  const top = span.offsetTop + Number.parseInt(computed.borderTopWidth, 10);
  const left = span.offsetLeft + Number.parseInt(computed.borderLeftWidth, 10);
  const height = Number.parseInt(computed.lineHeight, 10) || 16;
  doc.body.removeChild(div);
  return { top, left, height };
}

interface PopState {
  open: boolean;
  items: Sug[];
  active: number;
  /** Vùng [start,end) của phần đang gõ sẽ bị thay khi chấp nhận. */
  range: [number, number];
  top: number;
  left: number;
}
const POP_CLOSED: PopState = { open: false, items: [], active: 0, range: [0, 0], top: 0, left: 0 };

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { value, onChange, entities, className, placeholder, onRun },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [pop, setPop] = useState<PopState>(POP_CLOSED);

  // Index theo nhãn + tên kỹ thuật → tra cột cho `alias.` dù gõ tên nào.
  const byName = useMemo(() => indexEntitiesByName(entities), [entities]);

  /** Tính gợi ý tại caret. force=true → mở cả khi chưa gõ ký tự nào (Ctrl+Space). */
  const compute = useCallback(
    (text: string, caret: number, force: boolean): PopState => {
      const left = text.slice(0, caret);
      const word = /([A-Za-z0-9_]*)$/.exec(left)?.[1] ?? "";
      const wordStart = caret - word.length;
      const ta = taRef.current;
      if (!ta) return POP_CLOSED;

      // Member access: ký tự ngay trước phần đang gõ là '.'
      const dot = wordStart > 0 && text[wordStart - 1] === ".";
      let items: Sug[] = [];
      if (dot) {
        const prefix = /([A-Za-z0-9_]+)\.$/.exec(left.slice(0, wordStart))?.[1] ?? "";
        const aliasMap = buildAliasMap(text);
        const entName = aliasMap.get(prefix.toLowerCase());
        const ent = entName ? byName.get(entName.toLowerCase()) : undefined;
        if (ent) {
          items = [
            { label: "*", insert: "*", kind: "field", detail: "tất cả cột" },
            ...ent.fields.map((f) => ({
              label: f.name,
              insert: f.name,
              kind: "field" as const,
              detail: f.type,
            })),
          ];
        }
      } else {
        // Token keyword ngay trước phần đang gõ?
        const prevTok = /([A-Za-z]+)\s+$/.exec(left.slice(0, wordStart))?.[1]?.toUpperCase();
        if (prevTok === "FROM" || prevTok === "JOIN") {
          // vị trí tên đối tượng — gợi ý tên kỹ thuật
          items = entities.map(entitySug);
        } else {
          const aliasMap = buildAliasMap(text);
          const aliasItems: Sug[] = [...aliasMap.keys()].map((a) => ({
            label: a,
            insert: a,
            kind: "alias" as const,
          }));
          items = [
            ...SQL_KEYWORDS.map((k) => ({ label: k, insert: `${k} `, kind: "keyword" as const })),
            ...AGG_FNS.map((f) => ({ label: f, insert: `${f}(`, kind: "fn" as const })),
            ...aliasItems,
            ...entities.map(entitySug),
          ];
        }
      }

      // Lọc theo phần đang gõ — prefix lên trước, rồi includes.
      const q = word.toLowerCase();
      if (q) {
        const pre = items.filter((s) => s.label.toLowerCase().startsWith(q));
        const inc = items.filter(
          (s) => !s.label.toLowerCase().startsWith(q) && s.label.toLowerCase().includes(q),
        );
        items = [...pre, ...inc];
      } else if (!dot && !force) {
        // Chưa gõ gì + không phải member/force → không quấy rầy.
        // Ngoại lệ: ngay sau FROM/JOIN vẫn mở để liệt kê đối tượng.
        const prevTok = /([A-Za-z]+)\s+$/.exec(left.slice(0, wordStart))?.[1]?.toUpperCase();
        if (prevTok !== "FROM" && prevTok !== "JOIN") return POP_CLOSED;
      }

      // khử trùng theo label, cắt còn 50.
      const seen = new Set<string>();
      const dedup: Sug[] = [];
      for (const s of items) {
        if (seen.has(s.label)) continue;
        seen.add(s.label);
        dedup.push(s);
        if (dedup.length >= 50) break;
      }
      items = dedup;
      if (items.length === 0) return POP_CLOSED;

      const c = caretCoords(ta, caret);
      return {
        open: true,
        items,
        active: 0,
        range: [wordStart, caret],
        top: c.top - ta.scrollTop + c.height + 2,
        left: c.left - ta.scrollLeft,
      };
    },
    [byName, entities],
  );

  const refresh = useCallback(
    (text: string, caret: number, force = false) => setPop(compute(text, caret, force)),
    [compute],
  );

  const accept = (s: Sug) => {
    const ta = taRef.current;
    const [start, end] = pop.range;
    const next = value.slice(0, start) + s.insert + value.slice(end);
    onChange(next);
    setPop(POP_CLOSED);
    const caret = start + s.insert.length;
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = caret;
    });
  };

  /** SQL cần chạy: vùng chọn nếu có; nếu không, câu lệnh tại con trỏ (tách ';'); fallback toàn bộ. */
  const getRunSql = useCallback((): { sql: string; isSelection: boolean } => {
    const ta = taRef.current;
    if (!ta) return { sql: value.trim(), isSelection: false };
    const s = ta.selectionStart ?? 0;
    const e = ta.selectionEnd ?? 0;
    if (e > s) return { sql: value.slice(s, e), isSelection: true };
    const start = value.lastIndexOf(";", s - 1) + 1;
    let end = value.indexOf(";", s);
    if (end === -1) end = value.length;
    const stmt = value.slice(start, end).trim();
    return { sql: stmt || value.trim(), isSelection: false };
  }, [value]);

  const doRun = useCallback(() => {
    const { sql, isSelection } = getRunSql();
    if (sql) onRun?.(sql, isSelection);
  }, [getRunSql, onRun]);

  useImperativeHandle(ref, () => ({ run: doRun }), [doRun]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/⌘+Enter hoặc F5 → chạy SQL (vùng chọn / câu tại con trỏ).
    if (((e.ctrlKey || e.metaKey) && e.key === "Enter") || e.key === "F5") {
      e.preventDefault();
      setPop(POP_CLOSED);
      doRun();
      return;
    }
    // Ctrl/⌘+Space → mở gợi ý thủ công.
    if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
      e.preventDefault();
      const ta = e.currentTarget;
      refresh(ta.value, ta.selectionStart ?? 0, true);
      return;
    }
    if (!pop.open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPop((p) => ({ ...p, active: Math.min(p.active + 1, p.items.length - 1) }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPop((p) => ({ ...p, active: Math.max(p.active - 1, 0) }));
    } else if (e.key === "Enter" || e.key === "Tab") {
      const s = pop.items[pop.active];
      if (s) {
        e.preventDefault();
        accept(s);
      }
    } else if (e.key === "Escape") {
      // Đóng popup gợi ý; chặn bubble để KHÔNG kích hoạt Esc-thoát-fullscreen của panel.
      e.preventDefault();
      e.stopPropagation();
      setPop(POP_CLOSED);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <textarea
        ref={taRef}
        // KHÔNG dùng class `.input` (selector `textarea.input` đặt height:auto +
        // resize:vertical, ưu tiên cao hơn .h-full/.resize-none của Tailwind →
        // textarea co theo nội dung, không neo vào pane). Style tường minh để
        // h-full ăn → editor fill đúng pane-trên của split, không hiện tay kéo.
        className="w-full h-full min-h-0 resize-none rounded-md border border-border bg-bg-soft px-2.5 py-2 font-mono text-xs leading-relaxed text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 placeholder:text-muted"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart ?? 0);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          // Caret di chuyển bằng phím mũi tên/Home/End → tính lại ngữ cảnh.
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            refresh(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
          }
        }}
        onClick={(e) => refresh(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => {
          // Đóng sau click item (mousedown đã chạy accept trước blur).
          setTimeout(() => setPop(POP_CLOSED), 120);
        }}
      />

      {pop.open && (
        <ul
          className="absolute z-50 max-h-56 w-64 overflow-y-auto rounded-md border border-border bg-panel shadow-lg py-1 text-xs"
          style={{ top: pop.top, left: pop.left }}
        >
          {pop.items.map((s, i) => (
            <li key={`${s.kind}:${s.label}`}>
              <button
                type="button"
                // mousedown (không phải click) để chạy TRƯỚC onBlur của textarea.
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
                onMouseEnter={() => setPop((p) => ({ ...p, active: i }))}
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1 text-left",
                  i === pop.active ? "bg-accent/15 text-text" : "text-text/90 hover:bg-hover/40",
                )}
              >
                <span
                  className={cn(
                    "shrink-0 rounded px-1 py-0.5 text-[9px] leading-none",
                    badgeCls[s.kind],
                  )}
                >
                  {badgeText[s.kind]}
                </span>
                <span className="flex-1 truncate font-mono">{s.label}</span>
                {s.detail && <span className="shrink-0 text-[10px] text-muted">{s.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
