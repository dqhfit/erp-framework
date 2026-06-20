/* Pure util cho renderer: parse/export CSV-XLSX + lưu/đọc bố cục cá nhân
   (localStorage). Generic theo shape component nên dùng được với mọi
   PageComponent. Tách từ ConsumerPage.tsx. */

export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export async function exportCsvContentAsXlsx(csv: string, filename: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const rows = parseCsvRows(csv.replace(/^\uFEFF/, ""));
  const workbookRows = rows.map((row, rowIndex) =>
    row.map((value) => ({
      type: String,
      value,
      ...(rowIndex === 0 ? { fontWeight: "bold" as const } : {}),
    })),
  );
  // biome-ignore lint/suspicious/noExplicitAny: cell-shape của write-excel-file không có kiểu tiện dụng để tái sử dụng.
  await writeXlsxFile(workbookRows as any).toFile(`${filename || "export"}.xlsx`);
}

export function layoutStorageKey(pageId: string, userId: string | null): string {
  return userId ? `erp_layout_${userId}_${pageId}` : `erp_layout_${pageId}`;
}
export function loadPersonalLayout<T>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : null;
  } catch {
    return null;
  }
}
export function savePersonalLayoutLS<T>(key: string, comps: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(comps));
  } catch {
    /* quota */
  }
}
export function clearPersonalLayoutLS(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
