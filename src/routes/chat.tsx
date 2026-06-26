/* ==========================================================
   /chat — Chat noi bo nhan vien (DM 1-1 + nhom).
   2 khung: danh sach hoi thoai | thread + composer. Real-time qua /ws
   (kenh "chat:<id>" cho tin/typing/edit/delete/react trong thread,
   "chat-inbox:<me>" cho cap nhat danh sach/badge). Phase 2: sua/xoa tin,
   reaction emoji, "dang go", cham online, tim kiem. "Moi nhan vien 1 tai
   khoan" co san — dung users + company_members hien co.
   ========================================================== */
import {
  type ChatAttachment,
  type ChatConversationRow,
  type ChatDirectoryRow,
  type ChatMessageRow,
  type ChatReaction,
  type ChatSearchHit,
  createChatClient,
} from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button } from "@/components/ui";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useChannel } from "@/hooks/useRealtime";
import { dialog } from "@/lib/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";

const chat = createChatClient("");

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

/** Ten hien thi cua hoi thoai: nhom -> title; DM -> ten doi phuong. */
function convName(c: ChatConversationRow, me: string): string {
  if (c.kind === "group") return c.title || "Nhom khong ten";
  const other = (c.members ?? []).find((m) => m.userId !== me);
  return other?.name || other?.email || "Hoi thoai";
}

/** userId doi phuong cua 1 DM (de hien cham online). */
function dmPeerId(c: ChatConversationRow, me: string): string | null {
  if (c.kind !== "dm") return null;
  return (c.members ?? []).find((m) => m.userId !== me)?.userId ?? null;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

function timeShort(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

/** Cap nhat danh sach reaction sau 1 event react (toggle theo emoji + ai). */
function applyReaction(
  reactions: ChatReaction[],
  emoji: string,
  userId: string,
  added: boolean,
  me: string,
): ChatReaction[] {
  const next = reactions.map((r) => ({ ...r }));
  const entry = next.find((r) => r.emoji === emoji);
  if (added) {
    if (!entry) next.push({ emoji, count: 1, mine: userId === me });
    else {
      entry.count += 1;
      if (userId === me) entry.mine = true;
    }
  } else if (entry) {
    entry.count -= 1;
    if (userId === me) entry.mine = false;
    if (entry.count <= 0) return next.filter((r) => r.emoji !== emoji);
  }
  return next;
}

/* ─── Avatar gradient + cham online (chrome) ─────────────── */
function Avatar({ name, size = 36, online }: { name: string; size?: number; online?: boolean }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span
        className="rounded-full flex items-center justify-center text-white font-bold w-full h-full"
        style={{
          fontSize: size * 0.36,
          background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
        }}
      >
        {initials(name)}
      </span>
      {online && (
        <span
          className="absolute bottom-0 right-0 rounded-full bg-success ring-2 ring-panel"
          style={{ width: size * 0.3, height: size * 0.3 }}
          title="Đang online"
        />
      )}
    </span>
  );
}

function humanSize(n?: number): string {
  if (!n) return "";
  return n > 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/* ─── 1 dinh kem: anh -> thumbnail; khac -> chip tai ve ──── */
function AttachmentChip({ a }: { a: ChatAttachment }) {
  const isImg = (a.mime ?? "").startsWith("image/");
  if (isImg) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="block">
        <img
          src={a.url}
          alt={a.name}
          className="max-w-[220px] max-h-[220px] rounded-lg border border-border object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      download={a.name}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-panel-2 hover:bg-hover/50 max-w-[240px]"
    >
      <I.FileText size={16} className="text-muted shrink-0" />
      <span className="text-xs truncate flex-1">{a.name}</span>
      {a.size ? <span className="text-[10px] text-muted shrink-0">{humanSize(a.size)}</span> : null}
      <I.Download size={13} className="text-muted shrink-0" />
    </a>
  );
}

/* ─── 1 tin nhan: bubble + reaction + hanh dong (hover) ──── */
function MessageItem({
  msg,
  mine,
  showName,
  displayName,
  onReact,
  onEdit,
  onDelete,
}: {
  msg: ChatMessageRow;
  mine: boolean;
  showName: boolean;
  displayName: string;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactions = msg.reactions ?? [];
  return (
    <div
      className={cn(
        "group flex flex-col max-w-[78%]",
        mine ? "self-end items-end" : "self-start items-start",
      )}
    >
      {showName && <span className="text-[10px] text-muted ml-1 mb-0.5">{displayName}</span>}
      <div className={cn("flex items-end gap-1", mine && "flex-row-reverse")}>
        <div className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
          {msg.body && (
            <div
              className={cn(
                "px-3 py-1.5 rounded-2xl text-sm whitespace-pre-wrap break-words",
                mine
                  ? "bg-accent text-white rounded-br-sm"
                  : "bg-panel-2 text-text rounded-bl-sm border border-border",
              )}
            >
              {msg.body}
              {msg.editedAt && <span className="text-[9px] opacity-60 ml-1">(đã sửa)</span>}
            </div>
          )}
          {(msg.attachments ?? []).map((a) => (
            <AttachmentChip key={a.url} a={a} />
          ))}
        </div>
        {/* Hanh dong hover: react cho moi tin; sua/xoa chi tin cua minh */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity relative">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="w-6 h-6 rounded-full hover:bg-hover/60 text-muted flex items-center justify-center text-[13px]"
            title="Thả cảm xúc"
          >
            🙂
          </button>
          {mine && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="w-6 h-6 rounded-full hover:bg-hover/60 text-muted flex items-center justify-center"
                title="Sửa"
              >
                <I.Edit size={12} />
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="w-6 h-6 rounded-full hover:bg-danger/15 text-danger flex items-center justify-center"
                title="Xoá"
              >
                <I.Trash size={12} />
              </button>
            </>
          )}
          {pickerOpen && (
            <div className="absolute bottom-full mb-1 z-20 flex gap-0.5 px-1.5 py-1 rounded-full border border-border bg-panel shadow-lg">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onReact(e);
                    setPickerOpen(false);
                  }}
                  className="w-7 h-7 rounded-full hover:bg-hover/60 text-base flex items-center justify-center"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Chip reaction */}
      {reactions.length > 0 && (
        <div className={cn("flex gap-1 mt-0.5 flex-wrap", mine ? "justify-end" : "justify-start")}>
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onReact(r.emoji)}
              className={cn(
                "h-5 px-1.5 rounded-full text-[11px] flex items-center gap-0.5 border transition-colors",
                r.mine
                  ? "bg-accent/15 border-accent/40 text-text"
                  : "bg-panel-2 border-border text-muted hover:bg-hover/50",
              )}
              title={r.mine ? "Bỏ cảm xúc" : "Thả cảm xúc này"}
            >
              <span>{r.emoji}</span>
              <span>{r.count}</span>
            </button>
          ))}
        </div>
      )}
      <span className="text-[9px] text-muted mt-0.5 mx-1">{timeShort(msg.createdAt)}</span>
    </div>
  );
}

function ChatPage() {
  const me = useAuth((s) => s.user?.id) ?? "";
  const isMobile = useIsMobile();

  const [convs, setConvs] = useState<ChatConversationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [directory, setDirectory] = useState<ChatDirectoryRow[]>([]);
  const [groupMode, setGroupMode] = useState(false);
  const [groupPick, setGroupPick] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typers, setTypers] = useState<Record<string, { name: string; until: number }>>({});
  const [search, setSearch] = useState("");
  const [searchHits, setSearchHits] = useState<ChatSearchHit[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTypingRef = useRef(0);

  const loadConvs = useCallback(async () => {
    try {
      setConvs(await chat.conversations.list());
    } catch {
      /* loi mang — giu danh sach cu */
    }
  }, []);

  // Nap danh sach lan dau + deep-link ?c=<id>.
  useEffect(() => {
    void loadConvs();
    const cid = new URLSearchParams(window.location.search).get("c");
    if (cid) setSelectedId(cid);
  }, [loadConvs]);

  // Presence: poll online ~20s (in-memory phia server).
  // Guard: bỏ qua khi tab ẩn; fetch ngay khi tab hiện lại.
  useEffect(() => {
    const fetchPresence = () =>
      chat
        .presenceOnline()
        .then((r) => setOnline(new Set(r.online)))
        .catch(() => {
          /* ignore */
        });
    const onTick = () => {
      if (document.hidden) return;
      fetchPresence();
    };
    fetchPresence();
    const id = setInterval(onTick, 20_000);
    window.addEventListener("visibilitychange", onTick);
    return () => {
      clearInterval(id);
      window.removeEventListener("visibilitychange", onTick);
    };
  }, []);

  // Inbox: tin moi / hoi thoai moi → refresh danh sach + badge.
  useChannel(me ? `chat-inbox:${me}` : null, () => {
    void loadConvs();
  });

  // Nap tin nhan khi chon hoi thoai + danh dau da doc.
  const loadMessages = useCallback(async (cid: string) => {
    try {
      setMessages(await chat.messages.list(cid));
      await chat.messages.markRead(cid);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    setTypers({});
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  // Real-time trong thread dang mo: message / edit / delete / react / typing.
  useChannel(selectedId ? `chat:${selectedId}` : null, (payload) => {
    const p = payload as {
      type?: string;
      message?: ChatMessageRow;
      id?: string;
      body?: string;
      editedAt?: string;
      messageId?: string;
      emoji?: string;
      userId?: string;
      added?: boolean;
      name?: string;
    };
    switch (p.type) {
      case "message": {
        if (!p.message) return;
        setMessages((prev) =>
          prev.some((m) => m.id === p.message?.id) ? prev : [...prev, p.message as ChatMessageRow],
        );
        if (p.message.senderUserId !== me) void chat.messages.markRead(selectedId as string);
        void loadConvs();
        break;
      }
      case "edit":
        setMessages((prev) =>
          prev.map((m) =>
            m.id === p.id ? { ...m, body: p.body ?? m.body, editedAt: p.editedAt ?? null } : m,
          ),
        );
        break;
      case "delete":
        setMessages((prev) => prev.filter((m) => m.id !== p.id));
        break;
      case "react":
        if (!p.messageId || !p.emoji || !p.userId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === p.messageId
              ? {
                  ...m,
                  reactions: applyReaction(
                    m.reactions ?? [],
                    p.emoji as string,
                    p.userId as string,
                    !!p.added,
                    me,
                  ),
                }
              : m,
          ),
        );
        break;
      case "typing":
        if (p.userId && p.userId !== me) {
          setTypers((prev) => ({
            ...prev,
            [p.userId as string]: { name: p.name ?? "Ai đó", until: Date.now() + 3500 },
          }));
        }
        break;
    }
  });

  // Don typer het han moi giay.
  useEffect(() => {
    const id = setInterval(() => {
      setTypers((prev) => {
        const now = Date.now();
        const next: typeof prev = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (v.until > now) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Tim kiem (debounce 300ms).
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchHits(null);
      return;
    }
    const id = setTimeout(() => {
      chat
        .search(q)
        .then(setSearchHits)
        .catch(() => setSearchHits([]));
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // Cuon xuong cuoi khi co tin moi.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chu dich cuon theo so tin
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedId]);

  const selected = useMemo(
    () => convs.find((c) => c.id === selectedId) ?? null,
    [convs, selectedId],
  );

  const nameOf = useCallback(
    (uid: string): string => {
      const m = (selected?.members ?? []).find((x) => x.userId === uid);
      if (m) return m.name || m.email;
      const d = directory.find((x) => x.userId === uid);
      return d?.name || d?.email || "Nguoi dung";
    },
    [selected, directory],
  );

  const openNewChat = async () => {
    setNewChatOpen(true);
    setGroupMode(false);
    setGroupPick(new Set());
    if (directory.length === 0) {
      try {
        setDirectory(await chat.directory());
      } catch {
        /* ignore */
      }
    }
  };

  const startDm = async (userId: string) => {
    try {
      const r = await chat.conversations.openDm(userId);
      setNewChatOpen(false);
      await loadConvs();
      setSelectedId(r.conversationId);
    } catch (e) {
      void dialog.alert(`Khong mo duoc hoi thoai: ${(e as Error).message}`);
    }
  };

  const createGroup = async () => {
    const ids = [...groupPick];
    if (ids.length === 0) {
      void dialog.alert("Chon it nhat 1 thanh vien cho nhom.");
      return;
    }
    const title = await dialog.prompt("Ten nhom:", "");
    if (!title) return;
    try {
      const r = await chat.conversations.createGroup(title, ids);
      setNewChatOpen(false);
      await loadConvs();
      setSelectedId(r.conversationId);
    } catch (e) {
      void dialog.alert(`Khong tao duoc nhom: ${(e as Error).message}`);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if ((!body && pending.length === 0) || !selectedId || sending) return;
    setSending(true);
    try {
      await chat.messages.send(selectedId, body, pending.length > 0 ? pending : undefined);
      setDraft("");
      setPending([]);
    } catch (e) {
      void dialog.alert(`Gui that bai: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  // Tai file dinh kem (nhieu file). Moi file → upload → them vao pending.
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const a = await chat.uploadAttachment(f);
        setPending((p) => [...p, a]);
      }
    } catch (e) {
      void dialog.alert(`Tải lên thất bại: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Bao "dang go" — toi da 1 lan / 2s.
  const onDraftChange = (v: string) => {
    setDraft(v);
    if (!selectedId) return;
    const now = Date.now();
    if (now - lastTypingRef.current > 2000) {
      lastTypingRef.current = now;
      void chat.messages.typing(selectedId).catch(() => {});
    }
  };

  const react = (messageId: string, emoji: string) => {
    void chat.messages.react(messageId, emoji).catch(() => {});
  };
  const editMsg = async (m: ChatMessageRow) => {
    const body = await dialog.prompt("Sửa tin nhắn:", m.body);
    if (body == null || body.trim() === m.body) return;
    try {
      await chat.messages.edit(m.id, body.trim());
    } catch (e) {
      void dialog.alert(`Sửa thất bại: ${(e as Error).message}`);
    }
  };
  const deleteMsg = async (m: ChatMessageRow) => {
    if (!(await dialog.confirm("Xoá tin nhắn này?"))) return;
    try {
      await chat.messages.remove(m.id);
    } catch (e) {
      void dialog.alert(`Xoá thất bại: ${(e as Error).message}`);
    }
  };

  const typerNames = Object.values(typers).map((t) => t.name);
  const showList = !isMobile || !selectedId;
  const showThread = !isMobile || !!selectedId;

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* ── Danh sach hoi thoai ── */}
      {showList && (
        <div
          className={cn(
            "flex flex-col border-r border-border bg-panel/40 min-h-0",
            isMobile ? "w-full" : "w-72 shrink-0",
          )}
        >
          <div className="h-11 px-3 flex items-center gap-2 border-b border-border shrink-0">
            <span className="font-semibold text-sm flex-1">Tin nhắn</span>
            <Button size="sm" onClick={() => void openNewChat()} icon={<I.Plus size={14} />}>
              <span className="hidden sm:inline">Mới</span>
            </Button>
          </div>
          {/* O tim kiem */}
          <div className="px-2 py-1.5 border-b border-border shrink-0">
            <div className="flex items-center gap-1.5 input h-8 px-2">
              <I.Search size={13} className="text-muted shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tin nhắn…"
                className="bg-transparent outline-none text-sm flex-1 min-w-0"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="text-muted">
                  <I.X size={13} />
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {searchHits !== null ? (
              searchHits.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted">
                  Không tìm thấy tin nhắn.
                </div>
              ) : (
                searchHits.map((h) => {
                  const c = convs.find((x) => x.id === h.conversationId);
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(h.conversationId);
                        setSearch("");
                      }}
                      className="w-full text-left px-3 py-2.5 flex flex-col gap-0.5 hover:bg-hover/40 transition-colors border-b border-border/50"
                    >
                      <span className="text-xs font-medium truncate">
                        {c ? convName(c, me) : "Hội thoại"}
                      </span>
                      <span className="text-xs text-muted truncate">{h.body}</span>
                      <span className="text-[10px] text-muted">{timeShort(h.createdAt)}</span>
                    </button>
                  );
                })
              )
            ) : convs.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted">
                Chưa có cuộc trò chuyện. Bấm “Mới” để bắt đầu.
              </div>
            ) : (
              convs.map((c) => {
                const name = convName(c, me);
                const peerId = dmPeerId(c, me);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 flex gap-2.5 items-center hover:bg-hover/40 transition-colors border-b border-border/50",
                      c.id === selectedId && "bg-accent/10",
                    )}
                  >
                    <Avatar name={name} online={peerId ? online.has(peerId) : undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium truncate flex-1">{name}</span>
                        {c.lastMessage && (
                          <span className="text-[10px] text-muted shrink-0">
                            {timeShort(c.lastMessage.createdAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted truncate flex-1">
                          {c.lastMessage
                            ? c.lastMessage.body || "📎 Tệp đính kèm"
                            : "Chưa có tin nhắn"}
                        </span>
                        {c.unread > 0 && (
                          <span className="min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                            {c.unread > 99 ? "99+" : c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── Thread + composer ── */}
      {showThread && (
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {selected ? (
            <>
              <div className="h-11 px-3 flex items-center gap-2 border-b border-border shrink-0">
                {isMobile && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedId(null)}
                    icon={<I.ChevronLeft size={16} />}
                  />
                )}
                <Avatar
                  name={convName(selected, me)}
                  size={28}
                  online={(() => {
                    const pid = dmPeerId(selected, me);
                    return pid ? online.has(pid) : undefined;
                  })()}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{convName(selected, me)}</div>
                  {selected.kind === "group" && (
                    <div className="text-[11px] text-muted">
                      {(selected.members ?? []).length} thành viên
                    </div>
                  )}
                </div>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5"
              >
                {messages.map((m, i) => {
                  const mine = m.senderUserId === me;
                  const prev = messages[i - 1];
                  const showName =
                    selected.kind === "group" && !mine && prev?.senderUserId !== m.senderUserId;
                  return (
                    <MessageItem
                      key={m.id}
                      msg={m}
                      mine={mine}
                      showName={showName}
                      displayName={m.senderName ?? nameOf(m.senderUserId)}
                      onReact={(e) => react(m.id, e)}
                      onEdit={() => void editMsg(m)}
                      onDelete={() => void deleteMsg(m)}
                    />
                  );
                })}
                {messages.length === 0 && (
                  <div className="m-auto text-xs text-muted">Hãy gửi tin nhắn đầu tiên 👋</div>
                )}
              </div>

              {/* Dang go */}
              <div className="h-5 px-3 shrink-0 text-[11px] text-muted italic">
                {typerNames.length > 0 && `${typerNames.slice(0, 3).join(", ")} đang gõ…`}
              </div>

              <div className="border-t border-border shrink-0">
                {/* Chip dinh kem cho cho gui */}
                {(pending.length > 0 || uploading) && (
                  <div className="px-2 pt-2 flex flex-wrap gap-1.5">
                    {pending.map((a, i) => (
                      <span
                        key={a.url}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-panel-2 border border-border text-xs max-w-[180px]"
                      >
                        <I.FileText size={12} className="text-muted shrink-0" />
                        <span className="truncate flex-1">{a.name}</span>
                        <button
                          type="button"
                          onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                          className="text-muted hover:text-danger shrink-0"
                        >
                          <I.X size={12} />
                        </button>
                      </span>
                    ))}
                    {uploading && <span className="text-xs text-muted px-1 py-1">Đang tải…</span>}
                  </div>
                )}
                <div className="p-2 flex items-end gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleFiles(e.target.files)}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    title="Đính kèm tệp"
                  >
                    <span className="text-base leading-none">📎</span>
                  </Button>
                  <textarea
                    value={draft}
                    onChange={(e) => onDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={1}
                    placeholder="Nhập tin nhắn… (Enter để gửi, Shift+Enter xuống dòng)"
                    className="flex-1 resize-none max-h-32 input py-2"
                  />
                  <Button
                    onClick={() => void send()}
                    disabled={sending || (!draft.trim() && pending.length === 0)}
                    icon={<I.Send size={15} />}
                  >
                    <span className="hidden sm:inline">Gửi</span>
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3">
              <I.MessageSquare size={40} className="opacity-30" />
              <div className="text-sm">Chọn một cuộc trò chuyện hoặc bắt đầu cuộc mới.</div>
            </div>
          )}
        </div>
      )}

      {/* ── Panel "chat mới" ── */}
      {newChatOpen && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-panel shadow-xl flex flex-col max-h-[80vh]">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <span className="font-semibold text-sm flex-1">
                {groupMode ? "Tạo nhóm" : "Cuộc trò chuyện mới"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setGroupMode((g) => !g);
                  setGroupPick(new Set());
                }}
                icon={<I.Users size={14} />}
              >
                {groupMode ? "DM" : "Nhóm"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNewChatOpen(false)}
                icon={<I.X size={15} />}
              />
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-border/50">
              {directory.filter((d) => d.userId !== me).length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted">
                  Chưa có nhân viên nào khác trong công ty.
                </div>
              ) : (
                directory
                  .filter((d) => d.userId !== me)
                  .map((d) => {
                    const picked = groupPick.has(d.userId);
                    return (
                      <button
                        key={d.userId}
                        type="button"
                        onClick={() => {
                          if (groupMode) {
                            setGroupPick((s) => {
                              const n = new Set(s);
                              if (n.has(d.userId)) {
                                n.delete(d.userId);
                              } else {
                                n.add(d.userId);
                              }
                              return n;
                            });
                          } else {
                            void startDm(d.userId);
                          }
                        }}
                        className={cn(
                          "w-full text-left px-4 py-2.5 flex items-center gap-2.5 hover:bg-hover/40 transition-colors",
                          picked && "bg-accent/10",
                        )}
                      >
                        <Avatar name={d.name || d.email} size={32} online={online.has(d.userId)} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{d.name || d.email}</div>
                          <div className="text-[11px] text-muted truncate">{d.email}</div>
                        </div>
                        {groupMode && picked && <I.Check size={16} className="text-accent" />}
                      </button>
                    );
                  })
              )}
            </div>
            {groupMode && (
              <div className="px-4 py-3 border-t border-border flex items-center gap-2">
                <span className="text-xs text-muted flex-1">{groupPick.size} đã chọn</span>
                <Button onClick={() => void createGroup()} disabled={groupPick.size === 0}>
                  Tạo nhóm
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/chat")({ component: ChatPage });
