/* EdgesPanel — quan hệ FK chéo module (cross-module edges). Tách từ DiscoverTab.tsx. */
import { useState } from "react";
import { I } from "@/components/Icons";
import type { ManifestEdge } from "@/components/migration/manifest-types";
import { Card, Chip } from "@/components/ui";

export function EdgesPanel({ edges }: { edges: ManifestEdge[] }) {
  const [open, setOpen] = useState(true);
  if (edges.length === 0) return null;
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-medium text-warning hover:text-accent mb-2"
      >
        {open ? <I.ChevronDown size={14} /> : <I.ChevronRight size={14} />}
        Cross-module edges ({edges.length})
      </button>
      {open && (
        <>
          <div className="text-xs text-muted mb-2">
            Proc đụng bảng của module khác — cần thiết kế contract (tRPC/event) thay vì JOIN DB.
          </div>
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="text-left px-2 py-1.5">Proc</th>
                  <th className="text-left px-2 py-1.5">Bảng ngoài</th>
                  <th className="text-left px-2 py-1.5">Loại</th>
                  <th className="text-left px-2 py-1.5">Đề xuất contract</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((e) => (
                  <tr
                    key={`${e.proc}-${e.externalTable}-${e.kind}`}
                    className="border-t border-border"
                  >
                    <td className="px-2 py-1 font-mono">{e.proc}</td>
                    <td className="px-2 py-1 font-mono">{e.externalTable}</td>
                    <td className="px-2 py-1">
                      <Chip
                        variant={e.kind === "write" ? "warning" : "default"}
                        className="text-[10px]!"
                      >
                        {e.kind}
                      </Chip>
                    </td>
                    <td className="px-2 py-1 text-[11px] text-muted">
                      {e.suggestedContract ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
