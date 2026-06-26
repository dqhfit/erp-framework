-- 0090_knowledge_edges.sql
-- Tang knowledge-graph mong cho RAG: luu bo ba (subject, predicate, object)
-- trich tu cac doan (chunk) tri thuc de lam multi-hop retrieval -- noi cac
-- doan thuoc NHIEU nguon qua thuc the chung. Thay cho graphrag/cognee
-- (lech stack Python, da tenant kem) -- xem docs/AGENTIC-RAG-DESIGN.
--
-- - subject/object: ten thuc the DA CHUAN HOA (lowercase, bo dau) de khop;
--   subject_raw/object_raw giu ban goc de hien thi/cite.
-- - chunk_id: provenance (edge den tu doan nao). ON DELETE CASCADE -> re-ingest
--   xoa+chen lai chunk se tu don edge cu.
-- - source_id: de loc/xoa theo nguon + ke thua ACL khi expand.
-- - Idempotent: CREATE TABLE/INDEX IF NOT EXISTS (FK inline an toan re-run).

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_id   uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  chunk_id    uuid REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  subject     text NOT NULL,
  predicate   text NOT NULL,
  object      text NOT NULL,
  subject_raw text,
  object_raw  text,
  weight      real NOT NULL DEFAULT 1,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Tra 1-hop theo thuc the: tim edge co subject/object khop tap thuc the.
CREATE INDEX IF NOT EXISTS knowledge_edges_company_subject_idx
  ON knowledge_edges (company_id, subject);
CREATE INDEX IF NOT EXISTS knowledge_edges_company_object_idx
  ON knowledge_edges (company_id, object);
-- Loc/xoa theo nguon (re-ingest, xoa nguon).
CREATE INDEX IF NOT EXISTS knowledge_edges_source_idx
  ON knowledge_edges (source_id);
