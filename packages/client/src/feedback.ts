/* ==========================================================
   feedback.ts — Client SDK cho feedback.* router.
   User submit bất cập + đề xuất; admin triage qua status pipeline;
   AI summary + tags + similar-detection enrich từ server.
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export type FeedbackArea =
  | "entity" | "workflow" | "agent" | "settings"
  | "ui" | "performance" | "other";
export type FeedbackStatus = "new" | "in_progress" | "done" | "wontfix";
export type FeedbackSeverity = "nice_to_have" | "normal" | "blocker";

export interface FeedbackListItem {
  id: string;
  title: string;
  area: string;
  severity: FeedbackSeverity;
  status: FeedbackStatus;
  voteCount: number;
  aiSummary: string | null;
  aiTags: string[] | null;
  authorUserId: string;
  createdAt: string;
}

export interface FeedbackDetail extends Omit<FeedbackListItem, "aiTags"> {
  body: string;
  suggestion: string | null;
  url: string | null;
  entityRef: { entityId?: string; recordId?: string } | null;
  resolutionNote: string | null;
  aiTags: string[] | null;
  myVote: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

export interface FeedbackCommentRow {
  id: string;
  parentId: string | null;
  authorUserId: string;
  body: string;
  createdAt: string;
}

export interface SimilarHit {
  id: string;
  title: string;
  status: string;
  vote_count: number;
  similarity: number;
}

export interface FeedbackCreateInput {
  title: string;
  body: string;
  suggestion?: string;
  area: FeedbackArea;
  url?: string;
  entityRef?: { entityId?: string; recordId?: string };
  severity?: FeedbackSeverity;
}

export function createFeedbackClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    list: (filters?: {
      status?: FeedbackStatus; area?: FeedbackArea; mine?: boolean; limit?: number;
    }) => trpc.feedback.list.query(filters) as unknown as Promise<FeedbackListItem[]>,
    get: (id: string) => trpc.feedback.get.query(id) as unknown as Promise<FeedbackDetail>,
    create: (input: FeedbackCreateInput) =>
      trpc.feedback.create.mutate(input) as unknown as Promise<{ id: string }>,
    update: (input: { id: string; title?: string; body?: string;
      suggestion?: string; area?: FeedbackArea; severity?: FeedbackSeverity }) =>
      trpc.feedback.update.mutate(input),
    setStatus: (input: { id: string; status: FeedbackStatus; resolutionNote?: string }) =>
      trpc.feedback.setStatus.mutate(input),
    delete: (id: string) => trpc.feedback.delete.mutate(id),
    vote: (id: string) => trpc.feedback.vote.mutate(id),
    unvote: (id: string) => trpc.feedback.unvote.mutate(id),
    listComments: (feedbackId: string) =>
      trpc.feedback.listComments.query(feedbackId) as unknown as Promise<FeedbackCommentRow[]>,
    addComment: (input: { feedbackId: string; parentId?: string; body: string }) =>
      trpc.feedback.addComment.mutate(input),
    deleteComment: (id: string) => trpc.feedback.deleteComment.mutate(id),
    findSimilar: (input: { title: string; body?: string; limit?: number }) =>
      trpc.feedback.findSimilar.mutate(input) as unknown as Promise<SimilarHit[]>,
  };
}

export type FeedbackClient = ReturnType<typeof createFeedbackClient>;
