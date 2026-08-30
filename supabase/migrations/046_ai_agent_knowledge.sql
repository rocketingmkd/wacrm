-- ============================================================
-- 046_ai_agent_knowledge.sql — per-agent knowledge base.
--
-- Closes out the multi-agent AI design (044/045): each agent gets its
-- own RAG corpus instead of one shared per-account KB, so e.g.
-- "Suporte" and "Vendas" ground their answers in different documents.
--
-- `agent_id` is added NOT NULL (after a backfill) rather than left
-- nullable — every document belongs to exactly one agent going
-- forward; there is no "shared, unscoped" tier.
--
-- Backfill: every pre-existing document/chunk (there should be very
-- few — this account base is small) moves to its account's
-- receptionist agent. That agent is guaranteed to exist and be unique
-- per account (migration 044's `ai_agents_one_receptionist` partial
-- unique index) — so this is a safe, unambiguous target. Behaviourally
-- this is a no-op for every account that (like all of them today) has
-- exactly one agent: the receptionist keeps seeing the same KB it
-- always had.
--
-- The two retrieval RPCs (match_ai_knowledge_fts /
-- match_ai_knowledge_semantic) change their argument list (new
-- p_agent_id), which Postgres treats as a distinct function — the old
-- 3-arg signatures are DROPped explicitly rather than left dangling.
-- SECURITY INVOKER is preserved (see 032 — these must stay
-- RLS-governed, not SECURITY DEFINER, to avoid re-opening the
-- cross-account read that migration fixed).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE;

ALTER TABLE ai_knowledge_chunks
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE;

UPDATE ai_knowledge_documents d
SET agent_id = a.id
FROM ai_agents a
WHERE a.account_id = d.account_id
  AND a.is_receptionist
  AND d.agent_id IS NULL;

UPDATE ai_knowledge_chunks c
SET agent_id = d.agent_id
FROM ai_knowledge_documents d
WHERE d.id = c.document_id
  AND c.agent_id IS NULL;

-- A document whose account somehow has no receptionist (shouldn't
-- happen — 044 guarantees one per pre-existing account) would leave
-- agent_id NULL and fail the NOT NULL below with a clear error rather
-- than silently orphaning data.
ALTER TABLE ai_knowledge_documents
  ALTER COLUMN agent_id SET NOT NULL;
ALTER TABLE ai_knowledge_chunks
  ALTER COLUMN agent_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS ai_knowledge_documents_agent_id_idx
  ON ai_knowledge_documents (agent_id);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_agent_id_idx
  ON ai_knowledge_chunks (agent_id);

-- ============================================================
-- Retrieval RPCs — new signature (p_agent_id added). Old 3-arg
-- versions are dropped; nothing calls them anymore after this
-- deploy (src/lib/ai/knowledge.ts is updated in lockstep).
-- ============================================================
DROP FUNCTION IF EXISTS public.match_ai_knowledge_fts(uuid, text, integer);
DROP FUNCTION IF EXISTS public.match_ai_knowledge_semantic(uuid, text, integer);

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_agent_id    uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.agent_id = p_agent_id
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id      uuid,
  p_agent_id        uuid,
  p_query_embedding text,
  p_match_count     integer
)
RETURNS TABLE (id uuid, content text, distance real) AS $$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.agent_id = p_agent_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, uuid, text, integer) TO authenticated, service_role;
