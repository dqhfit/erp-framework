import { createFileRoute } from "@tanstack/react-router";
import { Card, Switch, Chip } from "@/components/ui";
import { I } from "@/components/Icons";
import { useRbac } from "@/stores/rbac";
import {
  ALL_ROLES, ALL_ACTIONS, ROLE_LABEL, ROLE_DESC, roleCan,
  type ObjectType,
} from "@/lib/permissions";

const OBJECTS: { key: ObjectType; label: string }[] = [
  { key: "entity", label: "Đối tượng" },
  { key: "page", label: "Trang" },
  { key: "workflow", label: "Workflow" },
  { key: "agent", label: "Agent" },
  { key: "activity", label: "Nhật ký" },
  { key: "knowledge", label: "Tri thức" },
  { key: "iot", label: "IoT" },
  { key: "settings", label: "Cấu hình" },
  { key: "rbac", label: "Vai trò" },
];

const ACTION_LABEL: Record<string, string> = {
  view: "Xem", create: "Tạo", edit: "Sửa", delete: "Xoá", run: "Chạy",
};

function RbacSettings() {
  const role = useRbac((s) => s.role);
  const enforce = useRbac((s) => s.enforce);
  const setRole = useRbac((s) => s.setRole);
  const setEnforce = useRbac((s) => s.setEnforce);

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Vai trò & Quyền (RBAC)</h1>
        <div className="text-sm text-muted mb-6">
          Phân quyền theo vai trò. UI sẽ ẩn/khoá thao tác mà vai trò hiện tại không được phép.
        </div>

        {/* === Enforcement toggle === */}
        <Card className="mb-4">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-md flex items-center justify-center text-white shrink-0"
                  style={{ background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))" }}>
              <I.Power size={18} />
            </span>
            <div className="flex-1">
              <div className="font-semibold">Bật kiểm soát quyền</div>
              <div className="text-sm text-muted mt-0.5 mb-2">
                Khi tắt, mọi thao tác được phép (tiện cho dev một người). Khi bật,
                UI tuân theo vai trò bên dưới.
              </div>
              <Switch checked={enforce} onChange={setEnforce}
                label={enforce ? "Đang kiểm soát" : "Đang tắt (toàn quyền)"} />
            </div>
          </div>
        </Card>

        {/* === Role picker === */}
        <Card className="mb-4">
          <div className="font-semibold mb-2">Vai trò phiên hiện tại</div>
          <div className="grid grid-cols-3 gap-2">
            {ALL_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={
                  "text-left p-3 rounded-md border transition-colors " +
                  (role === r
                    ? "border-accent bg-accent/10"
                    : "border-border hover:bg-hover/50")
                }
              >
                <div className="font-semibold flex items-center gap-2">
                  {ROLE_LABEL[r]}
                  {role === r && <Chip variant="success">Đang dùng</Chip>}
                </div>
                <div className="text-xs text-muted mt-1">{ROLE_DESC[r]}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* === Permission matrix === */}
        <Card>
          <div className="font-semibold mb-3">
            Ma trận quyền — vai trò <span className="text-accent">{ROLE_LABEL[role]}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-muted text-xs uppercase tracking-wide">
                  <th className="text-left py-2 pr-3 font-semibold">Object</th>
                  {ALL_ACTIONS.map((a) => (
                    <th key={a} className="py-2 px-2 font-semibold text-center">
                      {ACTION_LABEL[a]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {OBJECTS.map((o) => (
                  <tr key={o.key} className="border-t border-border">
                    <td className="py-2 pr-3 font-medium">{o.label}</td>
                    {ALL_ACTIONS.map((a) => {
                      const ok = roleCan(role, a, o.key);
                      return (
                        <td key={a} className="py-2 px-2 text-center">
                          {ok ? (
                            <I.Check size={15} className="inline text-success" />
                          ) : (
                            <I.Minus size={15} className="inline text-muted opacity-40" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted mt-3">
            Lưu ý: đây là RBAC phía client (chặn UI). Khi triển khai production
            đa người dùng, vai trò cần được xác thực lại ở backend/bridge.
          </div>
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/rbac")({ component: RbacSettings });
