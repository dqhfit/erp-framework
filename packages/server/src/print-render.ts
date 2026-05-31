/* ==========================================================
   print-render.ts — Engine in PDF (HTML→template).
   - renderTemplate: mini-handlebars ({{var}}, {{{raw}}}, {{#each}}, {{@index}}).
   - htmlToPdf: PLUGGABLE — dynamic import("puppeteer"); nếu chưa cài Chromium
     thì ném lỗi rõ ràng (mặc định in từ trình duyệt qua HTML).
   - scaffoldTemplateFromReport: blueprint report (legacy_reports) → template
     HTML mặc định (tiêu đề + bảng cột + CSS @page + nút In).
   ========================================================== */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as never)[k]), obj);
}

/** Render template với data. Hỗ trợ:
 *  - {{#each key}} ... {{field}} / {{this}} / {{@index}} ... {{/each}}
 *  - {{var}} (escape), {{{var}}} (raw) ở cấp ngoài. */
export function renderTemplate(tpl: string, data: Record<string, unknown>): string {
  // 1) Khối {{#each key}}...{{/each}}
  let out = tpl.replace(
    /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_m, key: string, body: string) => {
      const arr = getPath(data, key);
      const rows = Array.isArray(arr) ? arr : [];
      return rows
        .map((item, i) =>
          body.replace(/\{\{(\{?)\s*([\w.@]+)\s*\}?\}\}/g, (_mm, raw: string, p: string) => {
            let v: unknown;
            if (p === "@index") v = i + 1;
            else if (p === "this") v = item;
            else v = getPath(item, p) ?? getPath(data, p) ?? "";
            const s = v == null ? "" : String(v);
            return raw ? s : escapeHtml(s);
          }),
        )
        .join("");
    },
  );
  // 2) Biến cấp ngoài
  out = out.replace(/\{\{(\{?)\s*([\w.@]+)\s*\}?\}\}/g, (_m, raw: string, p: string) => {
    const v = getPath(data, p);
    const s = v == null ? "" : String(v);
    return raw ? s : escapeHtml(s);
  });
  return out;
}

export interface PdfOptions {
  pageSize?: string; // A4, Letter…
  orientation?: "portrait" | "landscape";
}

/** Lỗi rõ khi chưa cài Chromium — caller fallback sang trả HTML cho trình duyệt in. */
export class PdfEngineUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `Engine PDF (Puppeteer/Chromium) chưa sẵn sàng: ${detail}. ` +
        `Cài \`puppeteer\` + Chromium để xuất PDF tự động, hoặc in từ trình duyệt (Ctrl+P) trên bản HTML.`,
    );
    this.name = "PdfEngineUnavailableError";
  }
}

interface PuppeteerRequest {
  url: () => string;
  abort: () => Promise<void>;
  continue: () => Promise<void>;
}
interface PuppeteerPage {
  setContent: (h: string, o?: unknown) => Promise<void>;
  pdf: (o?: unknown) => Promise<Buffer>;
  setRequestInterception: (enabled: boolean) => Promise<void>;
  on: (event: string, handler: (req: PuppeteerRequest) => void) => void;
}
interface PuppeteerBrowser {
  newPage: () => Promise<PuppeteerPage>;
  close: () => Promise<void>;
}
interface PuppeteerLike {
  launch: (o?: unknown) => Promise<PuppeteerBrowser>;
}

/** HTML → PDF buffer qua Puppeteer (pluggable). Ném PdfEngineUnavailableError
 *  nếu puppeteer/Chromium chưa cài → caller trả HTML thay thế. */
export async function htmlToPdf(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  // Specifier qua biến → TS không resolve tĩnh (puppeteer là optional dep).
  const spec = "puppeteer";
  let puppeteer: PuppeteerLike;
  try {
    const mod = (await import(spec)) as { default?: PuppeteerLike } & PuppeteerLike;
    puppeteer = mod.default ?? mod;
  } catch (e) {
    throw new PdfEngineUnavailableError((e as Error).message);
  }
  let browser: PuppeteerBrowser | null = null;
  try {
    browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    // Chặn mọi request outbound — chỉ cho phép data: URL và about:blank.
    // Ngăn SSRF nếu template HTML chứa <img>/<script> trỏ vào internal host.
    await page.setRequestInterception(true);
    page.on("request", (req: PuppeteerRequest) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank") {
        req.continue().catch(() => undefined);
      } else {
        req.abort().catch(() => undefined);
      }
    });
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({
      format: opts.pageSize ?? "A4",
      landscape: opts.orientation === "landscape",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** Tên field placeholder (ASCII) từ nhãn cột tiếng Việt. */
function fieldSlug(label: string): string {
  const ascii = label.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  const s = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "cot";
}

export interface ReportBlueprintLike {
  reportClass: string;
  title: string | null;
  columns: string[];
  dataProcs: string[];
  kind: string;
}

/** Sinh template HTML mặc định từ blueprint report. */
export function scaffoldTemplateFromReport(bp: ReportBlueprintLike): string {
  const title = bp.title ?? bp.reportClass;
  const cols = bp.columns.length ? bp.columns : ["Cột 1", "Cột 2", "Cột 3"];
  const ths = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const tds = cols.map((c) => `<td>{{${fieldSlug(c)}}}</td>`).join("");
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  body { font-family: "Times New Roman", serif; font-size: 12px; color: #000; }
  h1 { text-align: center; font-size: 16px; text-transform: uppercase; margin: 0 0 4px; }
  .meta { display: flex; justify-content: space-between; font-size: 12px; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #000; padding: 3px 5px; font-size: 11px; vertical-align: top; }
  th { background: #eee; text-align: center; }
  td.num { text-align: right; }
  .sign { display: flex; justify-content: space-around; margin-top: 36px; text-align: center; }
  .no-print { margin-top: 16px; }
  @media print { .no-print { display: none; } }
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <div>Số: {{so_chung_tu}}</div>
    <div>Ngày: {{ngay}}</div>
  </div>
  <table>
    <thead><tr><th>STT</th>${ths}</tr></thead>
    <tbody>
      {{#each rows}}
      <tr><td class="num">{{@index}}</td>${tds}</tr>
      {{/each}}
    </tbody>
  </table>
  <div class="sign">
    <div>Người lập<br/><br/><br/>(Ký, họ tên)</div>
    <div>Người duyệt<br/><br/><br/>(Ký, họ tên)</div>
  </div>
  <!-- Nguồn: ${escapeHtml(bp.reportClass)} | data proc: ${escapeHtml(bp.dataProcs.join(", ") || "(chưa rõ)")} -->
  <!-- Sửa các placeholder {{...}} cho khớp tên field rows thật của procedure. -->
  <button class="no-print" onclick="window.print()">In / Lưu PDF</button>
</body></html>`;
}
