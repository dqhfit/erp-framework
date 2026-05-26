import type { ReactNode } from "react";

interface FormFieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}
export function FormField({ label, hint, error, children }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide">
          {label}
        </label>
      )}
      {children}
      {hint && !error && <div className="text-xs text-muted">{hint}</div>}
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}
