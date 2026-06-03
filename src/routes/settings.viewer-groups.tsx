/* ==========================================================
   settings.viewer-groups.tsx -- Quan ly nhom nguoi xem.
   Admin/Editor tao nhom, gan user viewer va trang vao nhom.
   Viewer trong portal chi thay trang duoc phan vao nhom cua ho
   (hoac trang khong han che nhom).
   ========================================================== */

import { createCompaniesClient, createObjectsClient } from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Input } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { useUserObjects } from "@/stores/userObjects";

const api = createObjectsClient("");
const companiesApi = createCompaniesClient("");

interface CompanyMember {
  userId: string;
  email: string;
  name: string;
  role: string;
}

const PRESET_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7"];

function ViewerGroupsSettings() {
  const t = useT();
  const viewerGroupsList = useUserObjects((s) => s.viewerGroupsList);
  const pages = useUserObjects((s) => s.pages);
  const hydrate = useUserObjects((s) => s.hydrate);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [savingGroup, setSavingGroup] = useState<string | null>(null);

  // Load company members once
  useEffect(() => {
    companiesApi
      .members()
      .then((rows) => {
        setMembers(
          rows.map((r) => ({
            userId: r.userId,
            email: r.email,
            name: r.name,
            role: r.role,
          })),
        );
      })
      .catch(() => {});
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await api.viewerGroups.create(name, newColor);
      setNewName("");
      setNewColor(PRESET_COLORS[0]);
      await hydrate();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await dialog.confirm(`Xoa nhom "${name}"? Khong the hoan tac.`, {
      title: "Xoa nhom",
      confirmText: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    await api.viewerGroups.delete(id);
    await hydrate();
    if (expandedId === id) setExpandedId(null);
  };

  const handleSetMembers = async (groupId: string, userIds: string[]) => {
    setSavingGroup(groupId);
    try {
      await api.viewerGroups.setMembers(groupId, userIds);
      await hydrate();
    } finally {
      setSavingGroup(null);
    }
  };

  // Helper: toggle membership of a user in a group
  const toggleMember = async (groupId: string, userId: string, currentMemberIds: string[]) => {
    const next = currentMemberIds.includes(userId)
      ? currentMemberIds.filter((id) => id !== userId)
      : [...currentMemberIds, userId];
    await handleSetMembers(groupId, next);
  };

  // Viewer-role members only shown for group assignment
  const viewerMembers = members.filter((m) => m.role === "viewer");

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[820px] mx-auto p-3 sm:p-8">
        <h1 className="text-xl font-semibold mb-1">{t("settings.viewer_groups")}</h1>
        <div className="text-sm text-muted mb-6">
          Nhom nguoi xem phan quyen trang portal. Viewer chi thay trang duoc phan vao nhom cua ho
          hoac trang khong han che nhom.
        </div>

        {/* Create group */}
        <Card className="mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className="w-5 h-5 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: c,
                    borderColor: newColor === c ? "white" : "transparent",
                    outline: newColor === c ? `2px solid ${c}` : "none",
                  }}
                  title={c}
                />
              ))}
            </div>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("settings.vg_name_ph")}
              className="flex-1 min-w-[160px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
            />
            <Button
              variant="primary"
              size="sm"
              icon={<I.Plus size={13} />}
              onClick={() => void handleCreate()}
              disabled={creating || !newName.trim()}
            >
              {t("settings.vg_create")}
            </Button>
          </div>
        </Card>

        {viewerGroupsList.length === 0 ? (
          <div className="text-sm text-muted text-center py-8">{t("settings.vg_empty")}</div>
        ) : (
          <div className="space-y-2">
            {viewerGroupsList.map((g) => {
              const expanded = expandedId === g.id;
              return (
                <Card key={g.id} className="overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: g.color }}
                    />
                    <button
                      type="button"
                      className="flex-1 text-left font-medium text-sm"
                      onClick={() => setExpandedId(expanded ? null : g.id)}
                    >
                      {g.name}
                    </button>
                    <span className="text-xs text-muted">
                      {g.memberIds.length} {t("settings.vg_members").toLowerCase()}
                    </span>
                    <span className="text-xs text-muted">
                      {g.pageIds.length} {t("settings.vg_pages").toLowerCase()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : g.id)}
                      className="w-6 h-6 flex items-center justify-center text-muted hover:text-text"
                    >
                      <I.ChevronRight
                        size={13}
                        className={
                          expanded ? "rotate-90 transition-transform" : "transition-transform"
                        }
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(g.id, g.name)}
                      className="w-6 h-6 flex items-center justify-center text-muted hover:text-danger"
                      title={t("common.delete")}
                    >
                      <I.Trash size={13} />
                    </button>
                  </div>

                  {/* Expanded panel */}
                  {expanded && (
                    <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-4">
                      {/* Members */}
                      <div>
                        <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                          {t("settings.vg_members")} (viewer)
                        </div>
                        {viewerMembers.length === 0 ? (
                          <div className="text-xs text-muted/60">Khong co viewer nao.</div>
                        ) : (
                          <div className="space-y-1">
                            {viewerMembers.map((m) => {
                              const isMember = g.memberIds.includes(m.userId);
                              return (
                                <label
                                  key={m.userId}
                                  className="flex items-center gap-2 py-0.5 cursor-pointer text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isMember}
                                    disabled={savingGroup === g.id}
                                    onChange={() => void toggleMember(g.id, m.userId, g.memberIds)}
                                    className="w-3.5 h-3.5"
                                  />
                                  <span className="flex-1 truncate">{m.name || m.email}</span>
                                  <span className="text-[10px] text-muted truncate max-w-[120px]">
                                    {m.email}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Pages */}
                      <div>
                        <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                          {t("settings.vg_pages")}
                        </div>
                        <div className="text-xs text-muted/60 mb-2">
                          Quan ly phan cong trang qua designer cua tung trang (nut Xuat ban).
                        </div>
                        {g.pageIds.length === 0 ? (
                          <div className="text-xs text-muted/60">Chua co trang nao.</div>
                        ) : (
                          <div className="space-y-1">
                            {g.pageIds.map((pid) => {
                              const pg = pages.find((p) => p.id === pid);
                              return (
                                <div key={pid} className="flex items-center gap-1.5 text-sm">
                                  <I.Layout size={11} className="text-muted shrink-0" />
                                  <span className="truncate">{pg?.name ?? pid.slice(0, 8)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/viewer-groups")({
  component: ViewerGroupsSettings,
});
