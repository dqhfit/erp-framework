import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EntityDef } from "@/types/entity";
import { uid } from "@/lib/utils";

interface EntitiesState {
  entities: EntityDef[];
  add: (e: Partial<EntityDef>) => EntityDef;
  update: (id: string, patch: Partial<EntityDef>) => void;
  remove: (id: string) => void;
  get: (id: string) => EntityDef | undefined;
}

export const useEntities = create<EntitiesState>()(
  persist(
    (set, getStore) => ({
      entities: [],
      add: (e) => {
        const entity: EntityDef = {
          id: e.id ?? uid("ent"),
          name: e.name ?? "entity",
          label: e.label ?? "Entity",
          primaryKey: e.primaryKey ?? "id",
          fields: e.fields ?? [{ key: "id", label: "ID", type: "text", required: true }],
          bindings: e.bindings ?? {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ entities: [...s.entities, entity] }));
        return entity;
      },
      update: (id, patch) => set((s) => ({
        entities: s.entities.map((e) =>
          e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e,
        ),
      })),
      remove: (id) => set((s) => ({ entities: s.entities.filter((e) => e.id !== id) })),
      get: (id) => getStore().entities.find((e) => e.id === id),
    }),
    { name: "erp-entities" },
  ),
);
