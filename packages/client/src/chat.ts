/* ==========================================================
   chat.ts — Client chat noi bo nhan vien. Boc router chat.*
   (conversations / messages / directory / unreadTotal).
   Per-user, membership-gated phia server. Real-time qua /ws
   (xem src/lib/realtime.ts) — client nay chi lo CRUD/REST.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface ChatMemberRef {
  userId: string;
  name: string;
  email: string;
}
export interface ChatLastMessage {
  body: string;
  createdAt: string;
  senderUserId: string;
}
export interface ChatConversationRow {
  id: string;
  kind: "dm" | "group";
  title: string | null;
  updatedAt: string;
  lastReadAt: string | null;
  unread: number;
  lastMessage: ChatLastMessage | null;
  members: ChatMemberRef[] | null;
}
export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
}
export interface ChatAttachment {
  url: string;
  name: string;
  mime?: string;
  size?: number;
}
export interface ChatMessageRow {
  id: string;
  senderUserId: string;
  body: string;
  attachments?: ChatAttachment[] | null;
  createdAt: string;
  editedAt?: string | null;
  senderName?: string;
  reactions?: ChatReaction[];
}
export interface ChatDirectoryRow {
  userId: string;
  name: string;
  email: string;
  role: string;
}
export interface ChatSearchHit {
  id: string;
  conversationId: string;
  body: string;
  createdAt: string;
  senderUserId: string;
}

export function createChatClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    /** Tai file dinh kem len (tai dung /upload/file → tra URL ky HMAC). */
    uploadAttachment: async (file: File): Promise<ChatAttachment> => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/upload/file`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Tải lên thất bại (${res.status})`);
      }
      const data = (await res.json()) as { url: string; name: string };
      return { url: data.url, name: data.name, mime: file.type || undefined, size: file.size };
    },
    /** Danh ba thanh vien cong ty (de bat dau chat). */
    directory: () => trpc.chat.directory.query() as Promise<ChatDirectoryRow[]>,
    /** Tong so tin chua doc (badge). */
    unreadTotal: () => trpc.chat.unreadTotal.query(),
    /** userId dang online trong cong ty (presence). */
    presenceOnline: () => trpc.chat.presenceOnline.query() as Promise<{ online: string[] }>,
    /** Tim tin nhan trong cac hoi thoai cua toi. */
    search: (q: string, limit?: number) =>
      trpc.chat.search.query({ q, limit }) as unknown as Promise<ChatSearchHit[]>,
    conversations: {
      list: () => trpc.chat.conversations.list.query() as Promise<ChatConversationRow[]>,
      openDm: (userId: string) => trpc.chat.conversations.openDm.mutate({ userId }),
      createGroup: (title: string, userIds: string[]) =>
        trpc.chat.conversations.createGroup.mutate({ title, userIds }),
    },
    messages: {
      list: (conversationId: string, opts?: { before?: string; limit?: number }) =>
        trpc.chat.messages.list.query({ conversationId, ...opts }) as Promise<ChatMessageRow[]>,
      send: (conversationId: string, body: string, attachments?: ChatAttachment[]) =>
        trpc.chat.messages.send.mutate({ conversationId, body, attachments }),
      markRead: (conversationId: string) => trpc.chat.messages.markRead.mutate({ conversationId }),
      edit: (messageId: string, body: string) =>
        trpc.chat.messages.edit.mutate({ messageId, body }),
      remove: (messageId: string) => trpc.chat.messages.remove.mutate({ messageId }),
      react: (messageId: string, emoji: string) =>
        trpc.chat.messages.react.mutate({ messageId, emoji }),
      typing: (conversationId: string) => trpc.chat.messages.typing.mutate({ conversationId }),
    },
  };
}

export type ChatClient = ReturnType<typeof createChatClient>;
