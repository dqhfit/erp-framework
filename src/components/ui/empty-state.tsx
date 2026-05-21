import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}
export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 text-muted">
      <div className="w-12 h-12 rounded-lg bg-panel-2 border border-border flex items-center justify-center mb-3">
        {icon}
      </div>
      <div className="text-text font-semibold mb-1">{title}</div>
      {hint && <div className="text-sm max-w-sm">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
