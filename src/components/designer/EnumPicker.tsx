import { Select } from "@/components/ui";
import { createEnumsClient } from "@erp-framework/client";
import { Link } from "@tanstack/react-router";
/* ==========================================================
   EnumPicker — Dropdown chọn enum tái sử dụng cho field type
   "enum" / "multi-enum". Load list từ /enums (lazy, cache theo
   instance), kèm link nhảy sang trang /enums để tạo mới.
   ========================================================== */
import { useEffect, useState } from "react";

const ec = createEnumsClient("");

interface EnumRow {
  id: string;
  name: string;
  label: string;
  enabled: boolean;
}

interface Props {
  value?: string;
  onChange: (id: string) => void;
}

export function EnumPicker({ value, onChange }: Props) {
  const [list, setList] = useState<EnumRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    ec.list()
      .then((r) => setList(r as EnumRow[]))
      .catch(() => {
        /* chưa đăng nhập / chưa migrate */
      })
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{loaded ? "— chọn enum —" : "Đang tải..."}</option>
        {list
          .filter((e) => e.enabled)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.label} ({e.name})
            </option>
          ))}
      </Select>
      {loaded && list.length === 0 && (
        <div className="text-[11px] text-muted">
          Chưa có enum.{" "}
          <Link to="/enums" className="text-accent hover:underline">
            Tạo enum ở /enums →
          </Link>
        </div>
      )}
    </div>
  );
}
