/* ==========================================================
   feedback.ts — Client SDK cho feedback.* router.
   User submit bất cập + đề xuất; admin triage qua status pipeline;
   AI summary + tags + similar-detection enrich từ server.
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export type FeedbackArea =
  | "entity"
  | "workflow"
  | "agent"
  | "settings"
  | "ui"
  | "performance"
  | "other";
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

/* ── Đề xuất AI (ai_proposals) + Lộ trình (roadmap_items) ─────────── */
export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "superseded";
export type RoadmapStatus = "planned" | "in_progress" | "done" | "dropped";

export type ProposalAction =
  | { type: "set_status"; feedbackIds: string[]; status: FeedbackStatus; resolutionNote?: string }
  | {
      type: "mark_duplicate";
      primaryId: string;
      duplicateIds: string[];
      status?: FeedbackStatus;
      resolutionNote?: string;
    }
  | {
      type: "add_to_roadmap";
      feedbackIds?: string[];
      roadmapId?: string;
      roadmap?: {
        title: string;
        description?: string;
        area?: string;
        priority?: "low" | "normal" | "high";
        targetQuarter?: string;
      };
      setStatus?: FeedbackStatus;
    };

export interface ProposalListItem {
  id: string;
  title: string;
  status: ProposalStatus;
  createdByKind: string;
  feedbackIds: string[] | null;
  createdAt: string;
  reviewedAt: string | null;
  appliedAt: string | null;
}

export interface ProposalDetail extends ProposalListItem {
  summary: string | null;
  actions: ProposalAction[];
  reviewNote: string | null;
  applyResult: unknown;
}

export interface RoadmapItem {
  id: string;
  title: string;
  description: string | null;
  area: string | null;
  status: RoadmapStatus;
  priority: "low" | "normal" | "high";
  targetQuarter: string | null;
  feedbackIds: string[] | null;
  source: string;
  createdAt: string;
  updatedAt: string;
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
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    list: (filters?: {
      status?: FeedbackStatus;
      area?: FeedbackArea;
      mine?: boolean;
      limit?: number;
    }) => trpc.feedback.list.query(filters) as unknown as Promise<FeedbackListItem[]>,
    get: (id: string) => trpc.feedback.get.query(id) as unknown as Promise<FeedbackDetail>,
    create: (input: FeedbackCreateInput) =>
      trpc.feedback.create.mutate(input) as unknown as Promise<{ id: string }>,
    update: (input: {
      id: string;
      title?: string;
      body?: string;
      suggestion?: string;
      area?: FeedbackArea;
      severity?: FeedbackSeverity;
    }) => trpc.feedback.update.mutate(input),
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
    mergeExport: (input: {
      status?: FeedbackStatus;
      area?: FeedbackArea;
      mine?: boolean;
      ai?: boolean;
    }) =>
      trpc.feedback.mergeExport.mutate(input) as unknown as Promise<{
        markdown: string;
        count: number;
        mode: "raw" | "ai";
        items: { id: string; title: string; status: FeedbackStatus }[];
        aiFailed?: boolean;
      }>,
    bulkSetStatus: (input: { ids: string[]; status: FeedbackStatus; resolutionNote?: string }) =>
      trpc.feedback.bulkSetStatus.mutate(input) as unknown as Promise<{
        ok: boolean;
        updated: number;
      }>,
    saveMergeBatch: (input: {
      status?: FeedbackStatus;
      area?: FeedbackArea;
      mine?: boolean;
      label?: string;
      note?: string;
    }) =>
      trpc.feedback.saveMergeBatch.mutate(input) as unknown as Promise<{
        id: string;
        label: string;
        itemCount: number;
      }>,
    listMergeBatches: () =>
      trpc.feedback.listMergeBatches.query() as unknown as Promise<
        Array<{
          id: string;
          label: string;
          note: string | null;
          itemCount: number;
          createdAt: string;
        }>
      >,
    getMergeBatch: (id: string) =>
      trpc.feedback.getMergeBatch.query(id) as unknown as Promise<{
        id: string;
        label: string;
        note: string | null;
        itemCount: number;
        createdAt: string;
        items: Array<{ id: string; title: string; status: FeedbackStatus }>;
      }>,
    deleteMergeBatch: (id: string) =>
      trpc.feedback.deleteMergeBatch.mutate(id) as unknown as Promise<{ ok: boolean }>,

    /* ── Đề xuất AI ── */
    listProposals: (input?: { status?: ProposalStatus }) =>
      trpc.feedback.listProposals.query(input) as unknown as Promise<ProposalListItem[]>,
    getProposal: (id: string) =>
      trpc.feedback.getProposal.query(id) as unknown as Promise<ProposalDetail>,
    approveProposal: (input: { id: string; reviewNote?: string }) =>
      trpc.feedback.approveProposal.mutate(input) as unknown as Promise<{
        ok: boolean;
        result: {
          statusUpdated: number;
          duplicatesMarked: number;
          roadmapCreated: { id: string; title: string }[];
          roadmapLinked: { id: string; added: number }[];
        };
      }>,
    rejectProposal: (input: { id: string; reviewNote?: string }) =>
      trpc.feedback.rejectProposal.mutate(input) as unknown as Promise<{ ok: boolean }>,

    /* ── Lộ trình ── */
    listRoadmap: (input?: { status?: RoadmapStatus }) =>
      trpc.feedback.listRoadmap.query(input) as unknown as Promise<RoadmapItem[]>,
    setRoadmapStatus: (input: { id: string; status: RoadmapStatus }) =>
      trpc.feedback.setRoadmapStatus.mutate(input) as unknown as Promise<{ ok: boolean }>,
    deleteRoadmap: (id: string) =>
      trpc.feedback.deleteRoadmap.mutate(id) as unknown as Promise<{ ok: boolean }>,
  };
}

export type FeedbackClient = ReturnType<typeof createFeedbackClient>;
