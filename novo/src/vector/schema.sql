CREATE EXTENSION IF NOT EXISTS vector;


-- conhecimento admin (vai para cache)
CREATE TABLE IF NOT EXISTS admin_policies (
id TEXT PRIMARY KEY,
title TEXT NOT NULL,
body TEXT NOT NULL,
rules_system TEXT NOT NULL DEFAULT 'Você é um assistente técnico. Responda de forma direta e cite números quando existirem.',
model TEXT NOT NULL DEFAULT 'gemini-2.0-flash-001',
created_at TIMESTAMP DEFAULT now()
);


-- vincula versões (hash do body+model) a caches do Gemini
CREATE TABLE IF NOT EXISTS policy_caches (
id TEXT PRIMARY KEY,
policy_id TEXT NOT NULL REFERENCES admin_policies(id) ON DELETE CASCADE,
gemini_cache_name TEXT NOT NULL,
model TEXT NOT NULL,
ttl_seconds INTEGER NOT NULL,
created_at TIMESTAMP DEFAULT now(),
expires_at TIMESTAMP NOT NULL
);


CREATE INDEX IF NOT EXISTS idx_policy_caches_policy ON policy_caches(policy_id);




CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'America/Fortaleza',
  kind TEXT NOT NULL,              -- 'once' | 'every' | 'weekly'
  payload JSONB NOT NULL,          -- guarda campos específicos (datetime, every, days...)
  enabled BOOLEAN NOT NULL DEFAULT true,
  exclude_dates TEXT[] DEFAULT '{}',
  next_at TIMESTAMP NULL,          -- próxima execução calculada
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_next_at ON schedules(next_at);
