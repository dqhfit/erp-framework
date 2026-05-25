/* ==========================================================
   useEnum — Lấy enum theo id, cache trong-process per page.
   Dùng cho FieldRenderer (AutoForm) khi field type là
   "enum"/"multi-enum".
   ========================================================== */
import { useEffect, useState } from "react";
import { createEnumsClient, type EnumValue } from "@erp-framework/client";

const ec = createEnumsClient("");
const cache = new Map<string, EnumRow>();

interface EnumRow {
  id: string;
  name: string;
  label: string;
  labelEn: string | null;
  values: EnumValue[];
  enabled: boolean;
}

export function useEnum(id: string | undefined): EnumRow | null {
  const [row, setRow] = useState<EnumRow | null>(
    id ? (cache.get(id) ?? null) : null,
  );
  useEffect(() => {
    if (!id) { setRow(null); return; }
    const cached = cache.get(id);
    if (cached) { setRow(cached); return; }
    ec.get(id).then((r) => {
      const d = r as EnumRow | null;
      if (d) { cache.set(id, d); setRow(d); }
    }).catch(() => { /* ignore */ });
  }, [id]);
  return row;
}
