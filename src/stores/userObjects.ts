import { createObjectsClient, type PageFlag } from "@erp-framework/client";
import type { DataSourceConfig } from "@erp-framework/core";
/* ==========================================================
   userObjects — Đối tượng low-code (entity / page / workflow /
   agent). Nguồn dữ liệu: PostgreSQL qua @erp-framework/client.
   Store giữ bản cache trong bộ nhớ; mutation cập nhật lạc quan
   rồi đẩy lên backend (fire-and-forget, lỗi ghi console).
   Gọi hydrate() sau khi đăng nhập để nạp dữ liệu.
   ========================================================== */
import { create } from "zustand";
import type {
  IconName,
  MockAgent,
  MockDataSource,
  MockEntity,
  MockPage,
  MockViewerGroup,
  MockWorkflow,
} from "@/lib/object-types";

/* URL tương đối — đi qua proxy /trpc của Vite (dev) hoặc nginx (prod). */
const api = createObjectsClient("");

type Row = Record<string, unknown>;

/* ─── slug + tên máy ────────────────────────────────────── */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "obj"
  );
}

/** Tên máy duy nhất cho cột UNIQUE (slug + 6 ký tự id). Export để designer
 *  hiển thị preview tên kỹ thuật sẽ tự sinh khi để trống. */
export function machineName(displayName: string, id: string): string {
  return `${slugify(displayName)}_${id.replace(/-/g, "").slice(0, 6)}`;
}

/* Helper cũ — giữ export để chỗ khác khỏi vỡ; backend là nguồn
   duy nhất nên không còn merge với mock. */
export function mergeById<T extends { id: string }>(_mock: T[], user: T[]): T[] {
  return user;
}

/* ─── Mapping DB row ↔ shape tầng app ───────────────────── */
function rowToEntity(r: Row): MockEntity {
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  // Phân tách entity.meta.bindings (Record<op, "proc:name" | ...>) thành
  // procBindings (chỉ giữ phần proc, lưu name không prefix).
  const rawBindings = (meta.bindings ?? null) as Record<string, string> | null;
  const procBindings: MockEntity["procBindings"] = rawBindings
    ? (Object.fromEntries(
        Object.entries(rawBindings)
          .filter(([, v]) => typeof v === "string" && v.startsWith("proc:"))
          .map(([k, v]) => [k, v.slice(5)]),
      ) as MockEntity["procBindings"])
    : undefined;
  return {
    id: r.id as string,
    name: (r.label as string) || (r.name as string) || "",
    // Tên kỹ thuật thật từ cột DB `name` — cho phép sửa ở designer.
    techName: (r.name as string) || undefined,
    icon: ((r.icon as string) || "Database") as IconName,
    mcp: (meta.mcp as string) || "",
    fields: ((r.fields ?? []) as MockEntity["fields"]).map((f, i) => ({
      ...f,
      id: f.id ?? `fld_${f.name ?? i}`,
    })),
    mcpBindings: meta.mcpBindings as MockEntity["mcpBindings"],
    procBindings,
    primaryKey: (meta.primaryKey as string) || undefined,
    // HYBRID: entity đã ở bảng thật (meta.storage.tier='table') → ẩn nút "Bảng thật".
    isTableBacked: (meta.storage as { tier?: string } | undefined)?.tier === "table",
  };
}
function entityToInput(e: MockEntity) {
  // Ghi bindings dạng prefixed về meta.bindings; chỉ ghi các op có giá trị.
  const bindings = e.procBindings
    ? Object.fromEntries(
        Object.entries(e.procBindings)
          .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
          .map(([k, v]) => [k, `proc:${(v as string).trim()}`]),
      )
    : {};
  return {
    id: e.id,
    // Ưu tiên tên kỹ thuật do user đặt; trống → tự sinh từ nhãn (như cũ).
    name: e.techName?.trim() || machineName(e.name, e.id),
    label: e.name,
    icon: e.icon,
    fields: e.fields,
    meta: {
      mcp: e.mcp,
      mcpBindings: e.mcpBindings ?? null,
      ...(e.primaryKey ? { primaryKey: e.primaryKey } : {}),
      ...(Object.keys(bindings).length ? { bindings } : {}),
    },
  };
}

function rowToPage(r: Row): MockPage {
  const upd = r.updatedAt ? new Date(r.updatedAt as string) : null;
  return {
    id: r.id as string,
    name: (r.label as string) || (r.name as string) || "",
    techName: (r.name as string) || undefined,
    icon: ((r.icon as string) || "Layout") as IconName,
    updated: upd ? upd.toLocaleDateString("vi-VN") : "—",
    author: "—",
    isPublished: (r.published as boolean) ?? false,
    publishMode: ((r.publishMode ?? r.publish_mode) as "private" | "public") ?? "private",
    viewerGroupIds: (r.viewerGroupIds as string[]) ?? [],
    status: (r.status as string | null) ?? null,
  };
}

function rowToWorkflow(r: Row): MockWorkflow {
  return {
    id: r.id as string,
    name: (r.name as string) || "",
    icon: "Workflow",
    status: r.isActive ? "active" : "paused",
    runs: 0,
    triggerType: (r.triggerType as MockWorkflow["triggerType"]) ?? "manual",
    triggerConfig: (r.triggerConfig ?? {}) as Record<string, unknown>,
  };
}

function rowToAgent(r: Row): MockAgent {
  const cfg = (r.config ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(cfg.tools) ? cfg.tools.length : 0;
  return {
    id: r.id as string,
    name: (r.name as string) || "",
    model: (r.model as string) || "claude-sonnet-4-6",
    tools,
    templateId: typeof cfg.templateId === "string" ? cfg.templateId : undefined,
  };
}

function rowToDataSource(r: Row): MockDataSource {
  const cfg = (r.config ?? {}) as Partial<DataSourceConfig>;
  return {
    id: r.id as string,
    name: (r.label as string) || (r.name as string) || "",
    icon: ((r.icon as string) || "Database") as IconName,
    baseEntityId: cfg.baseEntityId || undefined,
  };
}

/* ─── Store ─────────────────────────────────────────────── */
interface UserObjectsState {
  ready: boolean;
  entities: MockEntity[];
  pages: MockPage[];
  workflows: MockWorkflow[];
  agents: MockAgent[];
  dataSources: MockDataSource[];
  pageContent: Record<string, unknown>;
  workflowContent: Record<string, unknown>;
  agentContent: Record<string, unknown>;
  dataSourceContent: Record<string, DataSourceConfig>;
  myGroupIds: string[];
  /** PageId được cấp quyền cá nhân (ưu tiên hơn nhóm). */
  myPageIds: string[];
  viewerGroupsList: MockViewerGroup[];
  /** Cờ trạng thái TÙY CHỈNH ("cờ của tôi") per-company. */
  pageFlags: PageFlag[];

  hydrate: () => Promise<void>;

  addEntity: (e: MockEntity) => void;
  updateEntity: (id: string, patch: Partial<MockEntity>) => void;
  upsertEntity: (e: MockEntity) => void;
  deleteEntity: (id: string) => void;
  renameEntity: (id: string, name: string) => void;
  flushEntities: () => Promise<void>;

  addPage: (p: MockPage) => void;
  upsertPage: (p: MockPage) => void;
  deletePage: (id: string) => void;
  renamePage: (id: string, name: string) => void;
  setPageContent: (id: string, data: unknown) => void;
  publishPage: (id: string, mode: "private" | "public") => void;
  unpublishPage: (id: string) => void;
  /** Gắn/đổi/gỡ cờ trạng thái cho trang (status = key built-in | id cờ tùy chỉnh | null). */
  setPageStatus: (id: string, status: string | null) => void;
  /** Cờ tùy chỉnh: upsert (id rỗng = tạo mới) — trả về cờ đã lưu. */
  savePageFlag: (input: {
    id?: string;
    label: string;
    color: PageFlag["color"];
    icon?: string | null;
    sortOrder?: number;
  }) => Promise<PageFlag | undefined>;
  /** Xoá cờ tùy chỉnh + gỡ khỏi mọi trang đang gắn. */
  deletePageFlag: (id: string) => void;

  addWorkflow: (w: MockWorkflow) => void;
  deleteWorkflow: (id: string) => void;
  renameWorkflow: (id: string, name: string) => void;
  setWorkflowContent: (id: string, data: unknown) => void;
  /** Đổi nguồn trigger (cấp workflow) + lưu xuống DB. */
  setWorkflowTrigger: (
    id: string,
    triggerType: MockWorkflow["triggerType"],
    triggerConfig?: Record<string, unknown>,
  ) => void;

  addAgent: (a: MockAgent) => void;
  deleteAgent: (id: string) => void;
  renameAgent: (id: string, name: string) => void;
  setAgentContent: (id: string, data: unknown) => void;

  addDataSource: (d: MockDataSource) => void;
  upsertDataSource: (d: MockDataSource) => void;
  deleteDataSource: (id: string) => void;
  renameDataSource: (id: string, name: string) => void;
  setDataSourceContent: (id: string, cfg: DataSourceConfig) => void;

  setPageViewerGroups: (pageId: string, groupIds: string[]) => void;
}

/** Ghi nhật ký lỗi backend nhưng không chặn UI (cập nhật lạc quan). */
function bg(p: Promise<unknown>, what: string): void {
  p.catch((e) => console.error(`[userObjects] ${what} lỗi:`, e));
}

export const useUserObjects = create<UserObjectsState>()((set, get) => ({
  ready: false,
  entities: [],
  pages: [],
  workflows: [],
  agents: [],
  dataSources: [],
  pageContent: {},
  workflowContent: {},
  agentContent: {},
  dataSourceContent: {},
  myGroupIds: [],
  myPageIds: [],
  viewerGroupsList: [],
  pageFlags: [],

  hydrate: async () => {
    try {
      const [ents, pgs, wfs, ags, dss, myGroups, myPages, vGroups, pFlags] = await Promise.all([
        api.entities.list(),
        api.pages.list(),
        api.workflows.list(),
        api.agents.list(),
        api.dataSources.list().catch(() => [] as Row[]),
        api.viewerGroups.getMyGroups().catch(() => [] as string[]),
        api.viewerGroups.getMyPageAccess().catch(() => [] as string[]),
        api.viewerGroups
          .list()
          .catch(() => [] as Awaited<ReturnType<typeof api.viewerGroups.list>>),
        api.pages.flagList().catch(() => [] as PageFlag[]),
      ]);
      const pageContent: Record<string, unknown> = {};
      for (const r of pgs as Row[]) pageContent[r.id as string] = r.content ?? {};
      const workflowContent: Record<string, unknown> = {};
      for (const r of wfs as Row[]) workflowContent[r.id as string] = r.graph ?? {};
      const agentContent: Record<string, unknown> = {};
      for (const r of ags as Row[]) agentContent[r.id as string] = r.config ?? {};
      const dataSourceContent: Record<string, DataSourceConfig> = {};
      for (const r of dss as Row[])
        dataSourceContent[r.id as string] = (r.config ?? {}) as DataSourceConfig;
      set({
        ready: true,
        entities: (ents as Row[]).map(rowToEntity),
        pages: (pgs as Row[]).map(rowToPage),
        workflows: (wfs as Row[]).map(rowToWorkflow),
        agents: (ags as Row[]).map(rowToAgent),
        dataSources: (dss as Row[]).map(rowToDataSource),
        pageContent,
        workflowContent,
        agentContent,
        dataSourceContent,
        myGroupIds: myGroups,
        myPageIds: myPages,
        viewerGroupsList: vGroups as MockViewerGroup[],
        pageFlags: pFlags,
      });
    } catch (e) {
      console.error("[userObjects] hydrate lỗi:", e);
      set({ ready: true });
    }
  },

  /* ── Entity ── */
  addEntity: (e) => {
    set((s) => ({ entities: [...s.entities, e] }));
    bg(api.entities.save(entityToInput(e)), "lưu entity");
  },
  updateEntity: (id, patch) => {
    set((s) => ({
      entities: s.entities.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
    const e = get().entities.find((x) => x.id === id);
    if (e) bg(api.entities.save(entityToInput(e)), "lưu entity");
  },
  upsertEntity: (e) => {
    set((s) => {
      const i = s.entities.findIndex((x) => x.id === e.id);
      if (i >= 0) {
        const n = [...s.entities];
        n[i] = e;
        return { entities: n };
      }
      return { entities: [...s.entities, e] };
    });
    bg(api.entities.save(entityToInput(e)), "lưu entity");
  },
  deleteEntity: (id) => {
    set((s) => ({ entities: s.entities.filter((x) => x.id !== id) }));
    bg(api.entities.delete(id), "xoá entity");
  },
  renameEntity: (id, name) => {
    set((s) => ({
      entities: s.entities.map((x) => (x.id === id ? { ...x, name } : x)),
    }));
    const e = get().entities.find((x) => x.id === id);
    if (e) bg(api.entities.save(entityToInput(e)), "đổi tên entity");
  },
  flushEntities: async () => {
    const entities = get().entities;
    await Promise.all(entities.map((e) => api.entities.save(entityToInput(e))));
  },

  /* ── Page ── */
  addPage: (p) => {
    set((s) => ({ pages: [...s.pages, p] }));
    bg(
      api.pages.save({
        id: p.id,
        name: machineName(p.name, p.id),
        label: p.name,
        icon: p.icon,
        content: {},
      }),
      "lưu page",
    );
  },
  upsertPage: (p) => {
    set((s) => {
      const i = s.pages.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        const n = [...s.pages];
        n[i] = p;
        return { pages: n };
      }
      return { pages: [...s.pages, p] };
    });
    bg(
      api.pages.save({
        id: p.id,
        name: machineName(p.name, p.id),
        label: p.name,
        icon: p.icon,
        content: (get().pageContent[p.id] ?? {}) as Record<string, unknown>,
      }),
      "lưu page",
    );
  },
  deletePage: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.pageContent;
      return { pages: s.pages.filter((x) => x.id !== id), pageContent: rest };
    });
    bg(api.pages.delete(id), "xoá page");
  },
  renamePage: (id, name) => {
    set((s) => ({
      pages: s.pages.map((x) => (x.id === id ? { ...x, name } : x)),
    }));
    savePageById(get, id);
  },
  setPageContent: (id, data) => {
    set((s) => ({ pageContent: { ...s.pageContent, [id]: data } }));
    savePageById(get, id);
  },
  publishPage: (id, mode) => {
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, isPublished: true, publishMode: mode } : p)),
    }));
    bg(api.pages.publish(id, mode), "xuất bản page");
  },
  unpublishPage: (id) => {
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, isPublished: false } : p)),
    }));
    bg(api.pages.unpublish(id), "hủy xuất bản page");
  },
  setPageStatus: (id, status) => {
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, status } : p)),
    }));
    bg(api.pages.setStatus(id, status), "đổi cờ trang");
  },
  savePageFlag: async (input) => {
    try {
      const saved = await api.pages.flagSave(input);
      set((s) => {
        const i = s.pageFlags.findIndex((f) => f.id === saved.id);
        if (i >= 0) {
          const n = [...s.pageFlags];
          n[i] = saved;
          return { pageFlags: n };
        }
        return { pageFlags: [...s.pageFlags, saved] };
      });
      return saved;
    } catch (e) {
      console.error("[userObjects] lưu cờ tùy chỉnh lỗi:", e);
      return undefined;
    }
  },
  deletePageFlag: (id) => {
    set((s) => ({
      pageFlags: s.pageFlags.filter((f) => f.id !== id),
      // Gỡ cờ vừa xoá khỏi mọi trang đang gắn (đồng bộ optimistic với server).
      pages: s.pages.map((p) => (p.status === id ? { ...p, status: null } : p)),
    }));
    bg(api.pages.flagDelete(id), "xoá cờ tùy chỉnh");
  },

  /* ── Workflow ── */
  addWorkflow: (w) => {
    set((s) => ({ workflows: [...s.workflows, w] }));
    bg(
      api.workflows.save({
        id: w.id,
        name: w.name,
        isActive: w.status === "active",
        graph: {},
      }),
      "lưu workflow",
    );
  },
  deleteWorkflow: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.workflowContent;
      return { workflows: s.workflows.filter((x) => x.id !== id), workflowContent: rest };
    });
    bg(api.workflows.delete(id), "xoá workflow");
  },
  renameWorkflow: (id, name) => {
    set((s) => ({
      workflows: s.workflows.map((x) => (x.id === id ? { ...x, name } : x)),
    }));
    saveWorkflowById(get, id);
  },
  setWorkflowContent: (id, data) => {
    set((s) => ({ workflowContent: { ...s.workflowContent, [id]: data } }));
    saveWorkflowById(get, id);
  },
  setWorkflowTrigger: (id, triggerType, triggerConfig) => {
    set((s) => ({
      workflows: s.workflows.map((w) =>
        w.id === id
          ? { ...w, triggerType, ...(triggerConfig !== undefined ? { triggerConfig } : {}) }
          : w,
      ),
    }));
    saveWorkflowById(get, id);
  },

  /* ── Agent ── */
  addAgent: (a) => {
    set((s) => ({ agents: [...s.agents, a] }));
    bg(api.agents.save({ id: a.id, name: a.name, model: a.model, config: {} }), "lưu agent");
  },
  deleteAgent: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.agentContent;
      return { agents: s.agents.filter((x) => x.id !== id), agentContent: rest };
    });
    bg(api.agents.delete(id), "xoá agent");
  },
  renameAgent: (id, name) => {
    set((s) => ({
      agents: s.agents.map((x) => (x.id === id ? { ...x, name } : x)),
    }));
    saveAgentById(get, id);
  },
  setAgentContent: (id, data) => {
    // Đồng bộ tên + model hiển thị (sidebar dùng agents[].name) — UI
    // `/agents/$id` cho sửa cả 2 trong content, không qua renameAgent.
    // Nếu không sync, agents.name (cột bảng) lệch khỏi config.name.
    const d = (data ?? {}) as { name?: string; model?: string };
    set((s) => ({
      agentContent: { ...s.agentContent, [id]: data },
      agents:
        d.name || d.model
          ? s.agents.map((x) =>
              x.id === id
                ? {
                    ...x,
                    ...(d.name ? { name: d.name } : {}),
                    ...(d.model ? { model: d.model } : {}),
                  }
                : x,
            )
          : s.agents,
    }));
    saveAgentById(get, id);
  },

  /* ── Nguồn dữ liệu (DataSource) ── */
  addDataSource: (d) => {
    set((s) => ({
      dataSources: [...s.dataSources, d],
      dataSourceContent: {
        ...s.dataSourceContent,
        [d.id]: { baseEntityId: d.baseEntityId ?? "", relations: [], fields: [] },
      },
    }));
    saveDataSourceById(get, d.id);
  },
  upsertDataSource: (d) => {
    set((s) => {
      const i = s.dataSources.findIndex((x) => x.id === d.id);
      const list =
        i >= 0 ? s.dataSources.map((x) => (x.id === d.id ? d : x)) : [...s.dataSources, d];
      return { dataSources: list };
    });
    saveDataSourceById(get, d.id);
  },
  deleteDataSource: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.dataSourceContent;
      return { dataSources: s.dataSources.filter((x) => x.id !== id), dataSourceContent: rest };
    });
    bg(api.dataSources.delete(id), "xoá nguồn dữ liệu");
  },
  renameDataSource: (id, name) => {
    set((s) => ({
      dataSources: s.dataSources.map((x) => (x.id === id ? { ...x, name } : x)),
    }));
    saveDataSourceById(get, id);
  },
  setDataSourceContent: (id, cfg) => {
    set((s) => ({
      dataSourceContent: { ...s.dataSourceContent, [id]: cfg },
      // Đồng bộ baseEntityId hiển thị ở sidebar.
      dataSources: s.dataSources.map((x) =>
        x.id === id ? { ...x, baseEntityId: cfg.baseEntityId || undefined } : x,
      ),
    }));
    saveDataSourceById(get, id);
  },

  /* ── Viewer groups ── */
  setPageViewerGroups: (pageId, groupIds) => {
    set((s) => ({
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, viewerGroupIds: groupIds } : p)),
    }));
    bg(api.viewerGroups.setPageGroups(pageId, groupIds), "gan nhom cho trang");
  },
}));

/* ─── Helpers lưu trọn (đọc state hiện tại để dựng input) ── */
type Get = () => UserObjectsState;

function savePageById(get: Get, id: string): void {
  const p = get().pages.find((x) => x.id === id);
  if (!p) return;
  bg(
    api.pages.save({
      id: p.id,
      name: machineName(p.name, p.id),
      label: p.name,
      icon: p.icon,
      content: (get().pageContent[id] ?? {}) as Record<string, unknown>,
    }),
    "lưu page",
  );
}

function saveWorkflowById(get: Get, id: string): void {
  const w = get().workflows.find((x) => x.id === id);
  if (!w) return;
  bg(
    api.workflows.save({
      id: w.id,
      name: w.name,
      isActive: w.status === "active",
      triggerType: w.triggerType ?? "manual",
      triggerConfig: w.triggerConfig ?? {},
      graph: (get().workflowContent[id] ?? {}) as Record<string, unknown>,
    }),
    "lưu workflow",
  );
}

function saveAgentById(get: Get, id: string): void {
  const a = get().agents.find((x) => x.id === id);
  if (!a) return;
  bg(
    api.agents.save({
      id: a.id,
      name: a.name,
      model: a.model,
      config: (get().agentContent[id] ?? {}) as Record<string, unknown>,
    }),
    "lưu agent",
  );
}

function saveDataSourceById(get: Get, id: string): void {
  const d = get().dataSources.find((x) => x.id === id);
  if (!d) return;
  const cfg = get().dataSourceContent[id] ?? { baseEntityId: "", relations: [], fields: [] };
  bg(
    api.dataSources.save({
      id: d.id,
      name: machineName(d.name, d.id),
      label: d.name,
      icon: d.icon,
      config: cfg,
    }),
    "lưu nguồn dữ liệu",
  );
}
