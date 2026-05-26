/* ==========================================================
   DialogHost — Render Modal cho alert/confirm/prompt do
   dialog.alert/confirm/prompt() dispatch qua useDialog store.
   Mount 1 lần ở __root.tsx.
   ========================================================== */
import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useDialog } from "@/stores/dialog";

export function DialogHost() {
  const current = useDialog((s) => s.current);
  const close = useDialog((s) => s.close);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  // Reset value khi dialog mới mở (prompt)
  useEffect(() => {
    if (current?.kind === "prompt") {
      setValue(current.defaultValue ?? "");
      // Focus + select trên next tick
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
    } else {
      setValue("");
    }
  }, [current]);

  if (!current) return null;

  const handleOk = () => {
    if (current.kind === "prompt") close(value);
    else if (current.kind === "confirm") close(true);
    else close(null); // alert
  };
  const handleCancel = () => {
    if (current.kind === "alert") close(null);
    else close(false); // confirm/prompt: false / null
  };

  // Enter để confirm trong prompt
  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleOk();
    }
  };

  return (
    <Modal
      open={!!current}
      onClose={handleCancel}
      title={current.title}
      width={420}
      footer={
        <>
          {current.kind !== "alert" && (
            <Button variant="ghost" onClick={handleCancel}>
              {current.cancelText}
            </Button>
          )}
          <Button variant={current.danger ? "danger" : "primary"} onClick={handleOk}>
            {current.confirmText}
          </Button>
        </>
      }
    >
      {current.message && (
        <div className={current.kind === "prompt" ? "text-sm mb-3" : "text-sm whitespace-pre-wrap"}>
          {current.message}
        </div>
      )}
      {current.kind === "prompt" && (
        <input
          ref={inputRef}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={current.placeholder}
        />
      )}
    </Modal>
  );
}
