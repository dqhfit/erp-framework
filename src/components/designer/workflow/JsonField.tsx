/* JsonField — ô nhập JSON có buffer text riêng (gõ dở không revert),
   chỉ đẩy giá trị parse-được. Tách từ WorkflowDesigner.tsx. */
import { useState } from "react";
import { FormField, Textarea } from "@/components/ui";

/* Field nhập JSON có buffer text RIÊNG: cho phép gõ JSON dở dang mà
   value controlled không bị revert về chuỗi parse-được trước đó. Chỉ
   đẩy giá trị đã parse ra ngoài khi hợp lệ; lỗi cú pháp hiện cảnh báo
   nhưng KHÔNG mất nội dung đang gõ. Parent truyền `key` theo node id
   để remount (reset buffer) khi đổi node. */
export function JsonField({
  label,
  value,
  rows = 3,
  placeholder,
  expectArray = false,
  onValid,
}: {
  label: string;
  value: unknown;
  rows?: number;
  placeholder?: string;
  expectArray?: boolean;
  onValid: (v: unknown) => void;
}) {
  const [text, setText] = useState(() =>
    value === undefined || value === null || value === "" ? "" : JSON.stringify(value, null, 2),
  );
  const [err, setErr] = useState<string | null>(null);
  return (
    <FormField label={label}>
      <Textarea
        rows={rows}
        className="font-mono! text-xs! leading-relaxed"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (!v.trim()) {
            setErr(null);
            onValid(expectArray ? [] : {});
            return;
          }
          try {
            const parsed = JSON.parse(v);
            if (expectArray && !Array.isArray(parsed)) {
              setErr("Cần một mảng JSON []");
              return;
            }
            setErr(null);
            onValid(parsed);
          } catch (ex) {
            setErr((ex as Error).message);
          }
        }}
      />
      {err && <div className="text-[11px] text-danger mt-1">JSON lỗi: {err}</div>}
    </FormField>
  );
}
