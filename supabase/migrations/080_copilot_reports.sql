-- ============================================================
-- 080_copilot_reports.sql
--
-- Copiloto IA: relatórios de atendimento. Dois modos:
--   full     lê todos os atendimentos da conta
--   keyword  lê só as conversas em que o cliente escreveu a palavra/frase
--
--   1. copilot_reports       um pedido de relatório: filtros, progresso,
--                            resultado agregado (result) e texto da IA.
--   2. copilot_report_items  uma linha por conversa do relatório, com as
--                            métricas calculadas em código e a ficha que a
--                            IA devolveu. Serve de base para o JSON baixável.
--
-- Escritas vêm só do service role (a rota que processa o lote). Membros
-- (agent+) apenas leem as linhas da própria conta.
--
-- Idempotente: pode rodar de novo.
-- ============================================================

CREATE TABLE IF NOT EXISTS copilot_reports (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('full', 'keyword')),
  keyword       TEXT,
  -- Filtros opcionais: origem do lead e período da última mensagem.
  source_filter TEXT CHECK (source_filter IS NULL OR source_filter IN ('meta_ctwa', 'meta_site', 'google', 'other')),
  date_from     TIMESTAMPTZ,
  date_to       TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'done', 'error', 'cancelled')),
  total         INTEGER NOT NULL DEFAULT 0,
  processed     INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  provider      TEXT,
  model         TEXT,
  -- Números agregados (calculados em código) + resumo e recomendações da IA.
  result        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  CONSTRAINT copilot_reports_keyword_ck CHECK (mode <> 'keyword' OR (keyword IS NOT NULL AND length(keyword) >= 3))
);

CREATE INDEX IF NOT EXISTS idx_copilot_reports_account
  ON copilot_reports(account_id, created_at DESC);

ALTER TABLE copilot_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_reports_select ON copilot_reports;
CREATE POLICY copilot_reports_select ON copilot_reports
  FOR SELECT USING (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS copilot_report_items (
  report_id        UUID NOT NULL REFERENCES copilot_reports(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped', 'error')),
  -- Tempos e contagens calculados em código (nunca pela IA).
  metrics          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Ficha estruturada devolvida pela IA.
  analysis         JSONB,
  detail           TEXT,
  analyzed_at      TIMESTAMPTZ,
  PRIMARY KEY (report_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_copilot_report_items_pending
  ON copilot_report_items(report_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_copilot_report_items_account
  ON copilot_report_items(account_id);

ALTER TABLE copilot_report_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_report_items_select ON copilot_report_items;
CREATE POLICY copilot_report_items_select ON copilot_report_items
  FOR SELECT USING (is_account_member(account_id, 'agent'));

NOTIFY pgrst, 'reload schema';
