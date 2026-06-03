/* ==========================================================
   migration-codegen-workflow.ts — Tier C codegen: convert
   stored procedure T-SQL → WorkflowDef JSON (graph nodes+edges).

   Mapping LLM được instruct:
   - IF/CASE WHEN → node type="condition", config.expression
   - INSERT/UPDATE/DELETE → node type="action", config.action.kind="entity-*"
   - EXEC dbo.foo → node type="action", config.action.kind="procedure"
   - WHILE/cursor → node type="action" kind="raw-sql" (runtime chưa hỗ trợ lặp)

   Output validate qua zod; lỗi parse → throw. Caller (router) handle
   upsert vào bảng workflows.
   ========================================================== */

import { z } from "zod";
import type { DB } from "./db";
import { callLlmJson } from "./llm-json";

const NodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "trigger",
    "action",
    "condition",
    "agent",
    "agent_chain",
    "approval",
    "delay",
    "code",
    "procedure",
  ]),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.string(), z.unknown()),
});

const EdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
});

const GraphSchema = z.object({
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema),
});

export type WorkflowGraph = z.infer<typeof GraphSchema>;

export interface ProcWorkflowInput {
  name: string;
  body: string;
  reads: string[];
  writes: string[];
  /** Map tableName MSSQL → entityName trong hệ thống mới. */
  tableToEntity: Record<string, string>;
  label?: string;
  description?: string;
}

const SYSTEM_PROMPT = `Bạn là kỹ sư migrate stored procedure MSSQL sang Workflow visual của hệ thống low-code.

Output JSON với schema:
{
  "nodes": [
    {
      "id": "<unique node id snake_case>",
      "type": "trigger | action | condition | approval | delay",
      "position": { "x": <number>, "y": <number> },
      "config": { ... }
    }
  ],
  "edges": [
    {
      "id": "<unique edge id>",
      "source": "<node id>",
      "target": "<node id>",
      "sourceHandle": "true | false | <label>"
    }
  ]
}

Quy tắc mapping:
- Bắt đầu LUÔN có 1 node type="trigger" với config.triggerType="manual"
- IF/CASE/WHEN → 1 node type="condition" với config.expression="<SQL expression>"
  + 2 edge sourceHandle="true" và "false"
- INSERT INTO X → node type="action", config.action={kind:"entity-create", entity:"<X mapped>", fields:{...}}
- UPDATE X SET → node type="action", config.action={kind:"entity-update", entity:"<X mapped>", filter:{...}, set:{...}}
- DELETE FROM X → node type="action", config.action={kind:"entity-delete", entity:"<X mapped>", filter:{...}}
- EXEC dbo.foo @a, @b → node type="action", config.action={kind:"procedure", name:"<foo migrated name>", args:{...}}
- WHILE / cursor → runtime CHƯA hỗ trợ lặp; dùng node type="action" config.action={kind:"raw-sql", sql:"<SQL gốc>"} để human review sau
- RAISERROR/THROW → node type="action", config.action={kind:"raise-error", message:"..."}

Position layout: từ trên xuống, x=0 cho main flow, x=200 cho branch nhánh else.
Spacing y=120 giữa các node.

Nếu không thể chuyển 1 phần SQL thành node hợp lý, dùng node type="action" config.action={kind:"raw-sql", sql:"<SQL gốc>"} — đánh dấu để human review sau.

CHỈ trả về JSON, không markdown, không text thừa.`;

export interface CodegenWorkflowResult {
  graph: WorkflowGraph | null;
  /** Reason khi graph null. */
  error?: string;
  /** Raw LLM output để debug. */
  rawJson?: string;
}

export async function codegenProcWorkflow(
  db: DB,
  companyId: string,
  input: ProcWorkflowInput,
): Promise<CodegenWorkflowResult> {
  const mappingLines = Object.entries(input.tableToEntity)
    .map(([t, e]) => `- ${t} → ${e}`)
    .join("\n");

  const userPrompt = [
    `# Procedure: ${input.name}`,
    input.label ? `Label: ${input.label}` : "",
    input.description ? `Mô tả: ${input.description}` : "",
    `Reads: ${input.reads.join(", ") || "(none)"}`,
    `Writes: ${input.writes.join(", ") || "(none)"}`,
    "",
    "Bảng MSSQL → entity mapping:",
    mappingLines || "(chưa có mapping nào)",
    "",
    "T-SQL body:",
    "```sql",
    input.body.slice(0, 6000),
    "```",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callLlmJson<unknown>(db, companyId, {
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 4096,
    temperature: 0.1,
  });

  if (!raw) {
    return {
      graph: null,
      error: "LLM không trả về JSON hợp lệ (timeout / API lỗi / chưa cấu hình LLM).",
    };
  }

  const parsed = GraphSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      graph: null,
      error: `Schema validate fail: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      rawJson: JSON.stringify(raw),
    };
  }

  // Auto-add trigger node nếu LLM quên.
  let graph = parsed.data;
  if (!graph.nodes.some((n) => n.type === "trigger")) {
    const triggerId = "trigger_1";
    graph = {
      nodes: [
        {
          id: triggerId,
          type: "trigger",
          position: { x: 0, y: 0 },
          config: { triggerType: "manual" },
        },
        ...graph.nodes,
      ],
      edges: graph.edges,
    };
    // Nối trigger vào node đầu tiên (skip trigger nếu đã có).
    const first = parsed.data.nodes[0];
    if (first) {
      graph.edges = [
        { id: `e_trigger_${first.id}`, source: triggerId, target: first.id },
        ...graph.edges,
      ];
    }
  }

  return { graph };
}
