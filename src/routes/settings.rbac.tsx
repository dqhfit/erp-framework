import { createFileRoute } from "@tanstack/react-router";
import { I } from "@/components/Icons";
import { Card, Chip, Switch } from "@/components/ui";
import { useT } from "@/hooks/useT";
import {
  ALL_ACTIONS,
  ALL_ROLES,
  type ObjectType,
  ROLE_DESC,
  ROLE_LABEL,
  roleCan,
} from "@/lib/permissions";
import { useRbac } from "@/stores/rbac";

function RbacSettings() {
  const t = useT();
  const role = useRbac((s) => s.role);
  const enforce = useRbac((s) => s.enforce);
  const setRole = useRbac((s) => s.setRole);
  const setEnforce = useRbac((s) => s.setEnforce);

  const OBJECTS: { key: ObjectType; label: string }[] = [
    { key: "entity", label: t("settings.rbac.obj_entity") },
    { key: "page", label: t("settings.rbac.obj_page") },
    { key: "workflow", label: t("settings.rbac.obj_workflow") },
    { key: "agent", label: t("settings.rbac.obj_agent") },
    { key: "activity", label: t("settings.rbac.obj_activity") },
    { key: "knowledge", label: t("settings.rbac.obj_knowledge") },
    { key: "iot", label: t("settings.rbac.obj_iot") },
    { key: "settings", label: t("settings.rbac.obj_settings") },
    { key: "rbac", label: t("settings.rbac.obj_rbac") },
  ];
  const ACTION_LABEL: Record<string, string> = {
    view: t("settings.rbac.action_view"),
    create: t("settings.rbac.action_create"),
    edit: t("settings.rbac.action_edit"),
    delete: t("settings.rbac.action_delete"),
    run: t("settings.rbac.action_run"),
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-3 sm:p-5">
        <h1 className="text-sm font-semibold mb-1">{t("settings.rbac.title")}</h1>
        <div className="text-sm text-muted mb-3">{t("settings.rbac.subtitle")}</div>

        {/* === Enforcement toggle === */}
        <Card className="mb-4">
          <div className="flex items-start gap-3">
            <span
              className="w-10 h-10 rounded-md flex items-center justify-center text-white shrink-0"
              style={{
                background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
              }}
            >
              <I.Power size={18} />
            </span>
            <div className="flex-1">
              <div className="font-semibold">{t("settings.rbac.enforce_title")}</div>
              <div className="text-sm text-muted mt-0.5 mb-2">
                {t("settings.rbac.enforce_desc")}
              </div>
              <Switch
                checked={enforce}
                onChange={setEnforce}
                label={enforce ? t("settings.rbac.enforce_on") : t("settings.rbac.enforce_off")}
              />
            </div>
          </div>
        </Card>

        {/* === Role picker === */}
        <Card className="mb-4">
          <div className="font-semibold mb-2">{t("settings.rbac.session_role")}</div>
          <div className="grid grid-cols-3 gap-2">
            {ALL_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`text-left p-3 rounded-md border transition-colors ${
                  role === r ? "border-accent bg-accent/10" : "border-border hover:bg-hover/50"
                }`}
              >
                <div className="font-semibold flex items-center gap-2">
                  {ROLE_LABEL[r]}
                  {role === r && <Chip variant="success">{t("settings.rbac.active_chip")}</Chip>}
                </div>
                <div className="text-xs text-muted mt-1">{ROLE_DESC[r]}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* === Permission matrix === */}
        <Card>
          <div className="font-semibold mb-3">
            {t("settings.rbac.matrix_title")}{" "}
            <span className="text-accent">{ROLE_LABEL[role]}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-muted text-xs uppercase tracking-wide">
                  <th className="text-left py-2 pr-3 font-semibold">
                    {t("settings.rbac.col_object")}
                  </th>
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
          <div className="text-xs text-muted mt-3">{t("settings.rbac.note")}</div>
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/rbac")({ component: RbacSettings });
