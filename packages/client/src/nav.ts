/* ==========================================================
   nav.ts — Client wrapper cho tRPC nav.* (PA2 trinh dung menu).
   list() doc duoc boi moi user (render Sidebar); cac mutate chi admin.
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export type NavKind = "group" | "page" | "link";

export interface NavItem {
  id: string;
  parentId: string | null;
  kind: NavKind;
  label: string;
  icon: string | null;
  target: string | null;
  sortOrder: number;
}

export function createNavClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    /** Danh sach phang — UI tu dung cay theo parentId + sortOrder. */
    list: () => trpc.nav.list.query() as Promise<NavItem[]>,

    create: (input: {
      parentId?: string | null;
      kind: NavKind;
      label: string;
      icon?: string;
      target?: string;
    }) => trpc.nav.create.mutate(input) as Promise<{ id: string }>,

    update: (input: { id: string; label?: string; icon?: string | null; target?: string | null }) =>
      trpc.nav.update.mutate(input) as Promise<{ ok: boolean }>,

    /** Keo-tha: doi cha + thu tu cho 1 item. */
    move: (input: { id: string; parentId: string | null; sortOrder: number }) =>
      trpc.nav.move.mutate(input) as Promise<{ ok: boolean }>,

    /** Sap xep lai thu tu trong 1 nhom theo danh sach id. */
    reorder: (orderedIds: string[]) =>
      trpc.nav.reorder.mutate({ orderedIds }) as Promise<{ ok: boolean; count: number }>,

    remove: (id: string) => trpc.nav.delete.mutate({ id }) as Promise<{ ok: boolean }>,
  };
}

export type NavClient = ReturnType<typeof createNavClient>;
