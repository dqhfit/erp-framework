/* ==========================================================
   normalize.ts — Chuẩn hoá kết quả tool MCP về dạng rows
   (mảng object) + suy luận field khoá. Bản server-side, song
   song với src/lib/schema-infer.ts phía client.
   ========================================================== */

/** Chuẩn hoá bất kỳ shape data nào → mảng object (rows). */
export function normalizeRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    if (data.length && Array.isArray(data[0])) {
      return data.map((row) =>
        (row as unknown[]).reduce<Record<string, unknown>>(
          (o, v, i) => ({ ...o, [`col_${i + 1}`]: v }), {},
        ));
    }
    if (data.length && typeof data[0] !== "object") {
      return data.map((v) => ({ value: v }));
    }
    return data as Array<Record<string, unknown>>;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // MCP tool thường bọc kết quả: { content: [{ type:"text", text }] }.
    if (Array.isArray(obj.content)) {
      for (const part of obj.content as Array<Record<string, unknown>>) {
        if (part && part.type === "text" && typeof part.text === "string") {
          try {
            return normalizeRows(JSON.parse(part.text));
          } catch { /* không phải JSON — bỏ qua */ }
        }
      }
    }
    // Dạng bảng { columns, rows } — phải kiểm TRƯỚC vòng lặp khoá bao
    // bọc bên dưới, nếu không khoá "rows" sẽ chặn và trả về mảng-của-mảng thô.
    if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
      const cols = obj.columns as string[];
      return (obj.rows as unknown[][]).map((r) => {
        const o: Record<string, unknown> = {};
        cols.forEach((c, i) => (o[c] = r[i]));
        return o;
      });
    }
    for (const k of ["items", "data", "rows", "results", "list", "records"]) {
      if (Array.isArray(obj[k])) {
        return obj[k] as Array<Record<string, unknown>>;
      }
    }
    return [obj];
  }
  return [];
}

/** Suy luận field khoá của entity để khớp bản ghi khi đồng bộ. */
export function inferPkField(fieldNames: string[]): string {
  return (
    fieldNames.find((n) => n === "id")
    ?? fieldNames.find((n) => n === "code")
    ?? fieldNames.find((n) => /(^|_)id$/i.test(n))
    ?? fieldNames[0]
    ?? "id"
  );
}
