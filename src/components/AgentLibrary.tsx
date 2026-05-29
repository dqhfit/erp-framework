/* ==========================================================
   AgentLibrary — Modal chon template agent theo phong ban.
   User chon template → "Kich hoat" → tao agent trong cong ty.
   ========================================================== */
import { createObjectsClient } from "@erp-framework/client";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, Modal } from "@/components/ui";
import { useUserObjects } from "@/stores/userObjects";

const api = createObjectsClient("");

type Template = {
  id: string;
  department: string;
  departmentKey: string;
  icon: string;
  name: string;
  description: string;
  model: string;
  tools: string[];
  temperature: number;
  tags: string[];
};

const DEPT_LABELS: Record<string, string> = {
  ke_toan: "Ke toan",
  kinh_doanh: "Kinh doanh",
  nhan_su: "Nhan su",
  mua_hang: "Mua hang",
  kho_van: "Kho van",
  san_xuat: "San xuat",
  marketing: "Marketing",
  cham_soc_kh: "CSKH",
  phap_che: "Phap che",
};

const DEPT_ICON: Record<string, keyof typeof I> = {
  ke_toan: "Receipt",
  kinh_doanh: "BarChart2",
  nhan_su: "Users",
  mua_hang: "ShoppingCart",
  kho_van: "Warehouse",
  san_xuat: "Factory",
  marketing: "PenTool",
  cham_soc_kh: "MessageSquare",
  phap_che: "FileCheck",
} as const;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AgentLibrary({ open, onClose }: Props) {
  const navigate = useNavigate();
  const addAgent = useUserObjects((s) => s.addAgent);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());

  // Load templates khi mo modal lan dau
  const handleOpen = async () => {
    if (templates !== null) return;
    setLoading(true);
    try {
      const list = await api.agents.listTemplates();
      setTemplates(list as Template[]);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  if (open && templates === null && !loading) {
    void handleOpen();
  }

  const departments = Object.keys(DEPT_LABELS);

  const filtered = (templates ?? []).filter((t) => {
    const matchDept = activeTab === "all" || t.departmentKey === activeTab;
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    return matchDept && matchSearch;
  });

  const handleActivate = async (tpl: Template) => {
    setActivating(tpl.id);
    try {
      const row = await api.agents.instantiateTemplate(tpl.id);
      const agent = {
        id: (row as { id: string }).id,
        name: tpl.name,
        model: tpl.model,
        tools: tpl.tools.length,
      };
      addAgent(agent);
      setDone((prev) => new Set([...prev, tpl.id]));
      navigate({ to: "/agents/$id", params: { id: agent.id } });
      onClose();
    } catch {
      /* error toast handled upstream */
    } finally {
      setActivating(null);
    }
  };

  const iconFor = (name: string) => {
    const key = name as keyof typeof I;
    const Tag = I[key] ?? I.Bot;
    return <Tag size={18} />;
  };

  return (
    <Modal open={open} onClose={onClose} title="Thu vien Agent" width={760}>
      {/* Search */}
      <div className="mb-3">
        <div className="relative">
          <I.Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Tim kiem agent..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-input border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Department tabs */}
      <div className="flex gap-1 flex-wrap mb-4">
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            activeTab === "all"
              ? "bg-accent text-white"
              : "bg-muted/20 text-muted hover:bg-muted/30"
          }`}
        >
          Tat ca ({(templates ?? []).length})
        </button>
        {departments.map((dk) => {
          const count = (templates ?? []).filter((t) => t.departmentKey === dk).length;
          if (count === 0) return null;
          const DIcon = I[DEPT_ICON[dk] ?? "Bot"];
          return (
            <button
              key={dk}
              type="button"
              onClick={() => setActiveTab(dk)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                activeTab === dk
                  ? "bg-accent text-white"
                  : "bg-muted/20 text-muted hover:bg-muted/30"
              }`}
            >
              <DIcon size={11} />
              {DEPT_LABELS[dk]} ({count})
            </button>
          );
        })}
      </div>

      {/* Template grid */}
      <div className="max-h-[420px] overflow-y-auto pr-1">
        {loading && (
          <div className="flex items-center justify-center h-32 text-muted text-sm">
            <I.Loader size={16} className="animate-spin mr-2" />
            Dang tai...
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted text-sm gap-2">
            <I.SearchX size={24} />
            Khong tim thay agent phu hop
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {filtered.map((tpl) => {
              const isDone = done.has(tpl.id);
              const isActivating = activating === tpl.id;
              return (
                <div
                  key={tpl.id}
                  className="flex flex-col gap-2 p-3 border border-border rounded-lg bg-panel hover:border-accent/40 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className="w-8 h-8 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
                      {iconFor(tpl.icon)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm leading-tight">{tpl.name}</div>
                      <Chip className="mt-0.5 opacity-70 text-[10px] py-0">
                        {DEPT_LABELS[tpl.departmentKey] ?? tpl.department}
                      </Chip>
                    </div>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">{tpl.description}</p>
                  <div className="flex items-center gap-1 mt-auto">
                    <span className="text-[10px] text-muted bg-muted/10 rounded px-1.5 py-0.5">
                      {tpl.model.includes("haiku")
                        ? "Haiku"
                        : tpl.model.includes("opus")
                          ? "Opus"
                          : "Sonnet"}
                    </span>
                    <span className="text-[10px] text-muted bg-muted/10 rounded px-1.5 py-0.5">
                      {tpl.tools.length} tools
                    </span>
                    <div className="flex-1" />
                    {isDone ? (
                      <span className="text-xs text-green-500 flex items-center gap-1">
                        <I.CheckCircle size={13} /> Da kich hoat
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isActivating}
                        onClick={() => handleActivate(tpl)}
                        icon={
                          isActivating ? (
                            <I.Loader size={12} className="animate-spin" />
                          ) : (
                            <I.Zap size={12} />
                          )
                        }
                      >
                        {isActivating ? "Dang tao..." : "Kich hoat"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
