/* ==========================================================
   userObjects — Đối tượng low-code (entity / page / workflow /
   agent). Nguồn dữ liệu: PostgreSQL qua @erp-framework/client.
   Store giữ bản cache trong bộ nhớ; mutation cập nhật lạc quan
   rồi đẩy lên backend (fire-and-forget, lỗi ghi console).
   Gọi hydrate() sau khi đăng nhập để nạp dữ liệu.
   ========================================================== */
import { create } from "zustand";
import { createObjectsClient } from "@erp-framework/client";
import type {
  MockEntity, MockPage, MockWorkflow, MockAgent, IconName,
} from "@/lib/object-types";

/* URL tương đối — đi qua proxy /trpc của Vite (dev) hoặc nginx (prod). */
const api = createObjectsClient("");

type Row = Record<string, unknown>;

/* ─── slug + tên máy ────────────────────────────────────── */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "obj";
}

/** Tên máy duy nhất cho cột UNIQUE (slug + 6 ký tự id). */
function machineName(displayName: string, id: string): string {
  return slugify(displayName) + "_" + id.replace(/-/g, "").slice(0, 6);
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
    ? Object.fromEntries(
        Object.entries(rawBindings)
          .filter(([, v]) => typeof v === "string" && v.startsWith("proc:"))
          .map(([k, v]) => [k, v.slice(5)]),
      ) as MockEntity["procBindings"]
    : undefined;
  return {
    id: r.id as string,
    name: (r.label as string) || (r.name as string) || "",
    icon: ((r.icon as string) || "Database") as IconName,
    mcp: (meta.mcp as string) || "",
    fields: (r.fields ?? []) as MockEntity["fields"],
    mcpBindings: meta.mcpBindings as MockEntity["mcpBindings"],
    procBindings,
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
    name: machineName(e.name, e.id),
    label: e.name,
    icon: e.icon,
    fields: e.fields,
    meta: {
      mcp: e.mcp,
      mcpBindings: e.mcpBindings ?? null,
      ...(Object.keys(bindings).length ? { bindings } : {}),
    },
  };
}

function rowToPage(r: Row): MockPage {
  const upd = r.updatedAt ? new Date(r.updatedAt as string) : null;
  return {
    id: r.id as string,
    name: (r.label as string) || (r.name as string) || "",
    icon: ((r.icon as string) || "Layout") as IconName,
    updated: upd ? upd.toLocaleDateString("vi-VN") : "—",
    author: "—",
  };
}

function rowToWorkflow(r: Row): MockWorkflow {
  return {
    id: r.id as string,
    name: (r.name as string) || "",
    icon: "Workflow",
    status: r.isActive ? "active" : "paused",
    runs: 0,
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
  };
}

/* ─── Store ─────────────────────────────────────────────── */
interface UserObjectsState {
  ready: boolean;
  entities: MockEntity[];
  pages: MockPage[];
  workflows: MockWorkflow[];
  agents: MockAgent[];
  pageContent: Record<string, unknown>;
  workflowContent: Record<string, unknown>;
  agentContent: Record<string, unknown>;

  hydrate: () => Promise<void>;

  addEntity: (e: MockEntity) => void;
  updateEntity: (id: string, patch: Partial<MockEntity>) => void;
  upsertEntity: (e: MockEntity) => void;
  deleteEntity: (id: string) => void;
  renameEntity: (id: string, name: string) => void;

  addPage: (p: MockPage) => void;
  upsertPage: (p: MockPage) => void;
  deletePage: (id: string) => void;
  renamePage: (id: string, name: string) => void;
  setPageContent: (id: string, data: unknown) => void;

  addWorkflow: (w: MockWorkflow) => void;
  deleteWorkflow: (id: string) => void;
  renameWorkflow: (id: string, name: string) => void;
  setWorkflowContent: (id: string, data: unknown) => void;

  addAgent: (a: MockAgent) => void;
  deleteAgent: (id: string) => void;
  renameAgent: (id: string, name: string) => void;
  setAgentContent: (id: string, data: unknown) => void;
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
  pageContent: {},
  workflowContent: {},
  agentContent: {},

  hydrate: async () => {
    try {
      const [ents, pgs, wfs, ags] = await Promise.all([
        api.entities.list(),
        api.pages.list(),
        api.workflows.list(),
        api.agents.list(),
      ]);
      const pageContent: Record<string, unknown> = {};
      for (const r of pgs as Row[]) pageContent[r.id as string] = r.content ?? {};
      const workflowContent: Record<string, unknown> = {};
      for (const r of wfs as Row[]) workflowContent[r.id as string] = r.graph ?? {};
      const agentContent: Record<string, unknown> = {};
      for (const r of ags as Row[]) agentContent[r.id as string] = r.config ?? {};
      set({
        ready: true,
        entities: (ents as Row[]).map(rowToEntity),
        pages: (pgs as Row[]).map(rowToPage),
        workflows: (wfs as Row[]).map(rowToWorkflow),
        agents: (ags as Row[]).map(rowToAgent),
        pageContent, workflowContent, agentContent,
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
      if (i >= 0) { const n = [...s.entities]; n[i] = e; return { entities: n }; }
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

  /* ── Page ── */
  addPage: (p) => {
    set((s) => ({ pages: [...s.pages, p] }));
    bg(api.pages.save({
      id: p.id, name: machineName(p.name, p.id), label: p.name,
      icon: p.icon, content: {},
    }), "lưu page");
  },
  upsertPage: (p) => {
    set((s) => {
      const i = s.pages.findIndex((x) => x.id === p.id);
      if (i >= 0) { const n = [...s.pages]; n[i] = p; return { pages: n }; }
      return { pages: [...s.pages, p] };
    });
    bg(api.pages.save({
      id: p.id, name: machineName(p.name, p.id), label: p.name,
      icon: p.icon, content: (get().pageContent[p.id] ?? {}) as Record<string, unknown>,
    }), "lưu page");
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

  /* ── Workflow ── */
  addWorkflow: (w) => {
    set((s) => ({ workflows: [...s.workflows, w] }));
    bg(api.workflows.save({
      id: w.id, name: w.name, isActive: w.status === "active", graph: {},
    }), "lưu workflow");
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

  /* ── Agent ── */
  addAgent: (a) => {
    set((s) => ({ agents: [...s.agents, a] }));
    bg(api.agents.save({ id: a.id, name: a.name, model: a.model, config: {} }),
      "lưu agent");
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
      agents: (d.name || d.model)
        ? s.agents.map((x) => x.id === id ? {
            ...x,
            ...(d.name ? { name: d.name } : {}),
            ...(d.model ? { model: d.model } : {}),
          } : x)
        : s.agents,
    }));
    saveAgentById(get, id);
  },
}));

/* ─── Helpers lưu trọn (đọc state hiện tại để dựng input) ── */
type Get = () => UserObjectsState;

function savePageById(get: Get, id: string): void {
  const p = get().pages.find((x) => x.id === id);
  if (!p) return;
  bg(api.pages.save({
    id: p.id, name: machineName(p.name, p.id), label: p.name,
    icon: p.icon, content: (get().pageContent[id] ?? {}) as Record<string, unknown>,
  }), "lưu page");
}

function saveWorkflowById(get: Get, id: string): void {
  const w = get().workflows.find((x) => x.id === id);
  if (!w) return;
  bg(api.workflows.save({
    id: w.id, name: w.name, isActive: w.status === "active",
    graph: (get().workflowContent[id] ?? {}) as Record<string, unknown>,
  }), "lưu workflow");
}

function saveAgentById(get: Get, id: string): void {
  const a = get().agents.find((x) => x.id === id);
  if (!a) return;
  bg(api.agents.save({
    id: a.id, name: a.name, model: a.model,
    config: (get().agentContent[id] ?? {}) as Record<string, unknown>,
  }), "lưu agent");
}
