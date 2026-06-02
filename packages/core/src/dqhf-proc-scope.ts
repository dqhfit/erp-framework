/* ==========================================================
   dqhf-proc-scope.ts — Logic THUẦN (không I/O) gom stored proc
   của form DQHF theo MỨC METHOD, dùng chung cho:
     - server: packages/server/src/legacy-menu-resolve.ts (đọc fs)
     - browser: src/lib/dqhf-resolver.ts (File API)

   VÌ SAO CÓ FILE NÀY: resolver cũ quét theo CẢ FILE — hễ form đụng
   1 method của repo dùng chung (vd UnitOfWork.DINHMUC_GOVAN.GetAll),
   nó hốt SẠCH mọi MyQuery trong toàn bộ repo class → kéo về cả proc
   của form khác (repo là lớp data-access dùng chung nhiều form).

   Sửa: chỉ gom MyQuery trong THÂN các method mà form/control thật sự
   gọi. Form/control (không phải data-layer) vẫn lấy mọi MyQuery trực
   tiếp (chúng đặc thù cho 1 chức năng nên không nhiễu).
   ========================================================== */

/** lowerProp → tên repo class (segment cuối, vd CommonClass.BOL.TR_X → TR_X). */
export type UowMap = Map<string, string>;

/** MyQuery("PROC", ...) — bắt tên proc. */
const PROC_RE = /MyQuery\(\s*"([^"]+)"/g;
/** Proc hợp lệ = 1 identifier (loại MyQuery chứa SQL thô "SELECT ..."). */
const PROC_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Path lớp data-layer DÙNG CHUNG → MyQuery phải scope theo method gọi.
 *  UserCtrl/FormReport KHÔNG nằm đây: chúng đặc thù form nên lấy hết. */
export const SHARED_DATA_RE = /[\\/](CommonClass[\\/](BOL|DAL|MODELS)|DQHF\.Repository)[\\/]/i;

/** Lời gọi qua UnitOfWork/biến uow: `.<Prop>.<Method>(` (vd UnitOfWork.X.GetAll( ). */
const CALL_VIA_PROP = /\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g;
/** Lời gọi qua khởi tạo trực tiếp: `new <Class>(...).<Method>(`. */
const CALL_VIA_NEW = /new\s+([A-Za-z_][\w.]*)\s*\([^;(){}]*\)\s*\.([A-Za-z_]\w*)\s*\(/g;

/** Một lời gọi method repo: class (lower, segment cuối) + tên method. */
export interface RepoMethodCall {
  cls: string;
  method: string;
}

/** Segment cuối của tên type generic: CommonClass.BOL.TR_X → TR_X. */
export function lastTypeSegment(t: string): string {
  const parts = t.split(".");
  return parts[parts.length - 1] ?? t;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lấy mọi tên proc (MyQuery) trong 1 đoạn text. */
function collectProcsIn(text: string, into: Set<string>): void {
  PROC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROC_RE.exec(text))) {
    const name = m[1]!;
    if (PROC_ID.test(name)) into.add(name);
  }
}

/** Trích các cặp (repoClass, method) mà 1 file gọi.
 *  - `.<Prop>.<Method>(`  → repoClass = uowMap[Prop]
 *  - `new <Class>(...).<Method>(` → repoClass = <Class> */
export function extractRepoMethodCalls(text: string, uowMap: UowMap): RepoMethodCall[] {
  const out: RepoMethodCall[] = [];
  let m: RegExpExecArray | null;

  CALL_VIA_PROP.lastIndex = 0;
  while ((m = CALL_VIA_PROP.exec(text))) {
    const repo = uowMap.get(m[1]!.toLowerCase());
    if (repo) out.push({ cls: lastTypeSegment(repo).toLowerCase(), method: m[2]! });
  }

  CALL_VIA_NEW.lastIndex = 0;
  while ((m = CALL_VIA_NEW.exec(text))) {
    out.push({ cls: lastTypeSegment(m[1]!).toLowerCase(), method: m[2]! });
  }

  return out;
}

/** Tìm THÂN method tên `name` trong class text → trả chuỗi body (gồm `{...}`),
 *  hoặc null nếu không thấy ĐỊNH NGHĨA (phân biệt với lời gọi cùng tên).
 *
 *  Heuristic: `name(` mà (a) phía trước (bỏ khoảng trắng) là ký tự kết-thúc-type
 *  [\w>\]] (tức có return type → là định nghĩa, KHÔNG phải `.name(` hay `(name(`),
 *  và (b) sau `)` (đã match ngoặc) là `{` (cho phép `where T: ...` chen giữa). */
function findMethodBody(text: string, name: string): string | null {
  const nameRe = new RegExp(`\\b${escapeRe(name)}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(text))) {
    // (a) ký tự không-trắng ngay trước tên phải là cuối-type (loại lời gọi).
    let b = m.index - 1;
    while (b >= 0 && /\s/.test(text[b]!)) b--;
    if (b < 0 || !/[A-Za-z0-9_>\]]/.test(text[b]!)) continue;

    // Khớp ngoặc param list.
    const i = m.index + m[0].length - 1; // vị trí '('
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j]!;
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }

    // (b) sau ')' phải tới '{' (cho phép where-constraint), không gặp ';' trước.
    let bodyStart = -1;
    for (let p = j; p < text.length; p++) {
      const c = text[p]!;
      if (c === "{") {
        bodyStart = p;
        break;
      }
      if (c === ";") break; // khai báo abstract/interface/ lời gọi → bỏ
      if (!/[\sA-Za-z0-9_:<>.,]/.test(c)) break; // ký tự lạ → không phải header
    }
    if (bodyStart < 0) continue;

    // Khớp ngoặc nhọn lấy trọn body.
    let d = 0;
    for (let p = bodyStart; p < text.length; p++) {
      const c = text[p]!;
      if (c === "{") d++;
      else if (c === "}") {
        d--;
        if (d === 0) return text.slice(bodyStart, p + 1);
      }
    }
  }
  return null;
}

/** Gom proc của 1 file data-layer DÙNG CHUNG, scope theo method được gọi.
 *  - `calledMethods` rỗng/undefined (file được tham chiếu nhưng không rõ
 *    method nào) → fallback lấy MỌI MyQuery (giữ hành vi cũ, tránh sót).
 *  - Có method → chỉ gom MyQuery trong thân các method đó. */
export function collectScopedProcs(
  text: string,
  calledMethods: Set<string> | undefined,
): Set<string> {
  const procs = new Set<string>();
  if (!calledMethods || calledMethods.size === 0) {
    collectProcsIn(text, procs);
    return procs;
  }
  for (const method of calledMethods) {
    const body = findMethodBody(text, method);
    if (body) collectProcsIn(body, procs);
  }
  return procs;
}

/** Lấy mọi MyQuery TRỰC TIẾP của 1 file (dùng cho form/control — không scope). */
export function collectDirectProcs(text: string): Set<string> {
  const procs = new Set<string>();
  collectProcsIn(text, procs);
  return procs;
}

/** Trích lời gọi repo LỒNG trong thân các method chỉ định (repo gọi repo khác).
 *  Dùng để lan truyền call-graph qua data-layer mà KHÔNG quét cả file (tránh
 *  kéo proc của method repo mà form không đụng). */
export function extractCallsInMethods(
  text: string,
  methods: Iterable<string>,
  uowMap: UowMap,
): RepoMethodCall[] {
  const out: RepoMethodCall[] = [];
  for (const method of methods) {
    const body = findMethodBody(text, method);
    if (body) out.push(...extractRepoMethodCalls(body, uowMap));
  }
  return out;
}
