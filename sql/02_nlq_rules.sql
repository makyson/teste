CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS nlq_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('schedule_report','threshold_alert')),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','active')),
  schedule_cron TEXT,
  prompt TEXT NOT NULL,
  cypher TEXT,
  sql TEXT,
  sql_params JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  last_run_at TIMESTAMPTZ,
  last_result JSONB,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nlq_rules_company ON nlq_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_nlq_rules_status ON nlq_rules(status);
