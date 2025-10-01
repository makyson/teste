// src/nlq/prompts.js

// 👉 Helper opcional: passe um "contexto" real lido do Timescale/Neo4j
// Ex.: { minDay: '2025-09-01', maxDay: '2025-09-10', companies: ['company-1'] }
function renderContext(ctx = {}) {
  const lines = [];
  if (ctx.minDay && ctx.maxDay) {
    lines.push(
      `Janela de dados disponível em daily_metrics.day: ${ctx.minDay} -> ${ctx.maxDay} (UTC).`
    );
  }
  if (Array.isArray(ctx.companies) && ctx.companies.length) {
    lines.push(`Empresas conhecidas: ${ctx.companies.join(", ")}.`);
  }
  if (ctx.note) lines.push(ctx.note);
  return lines.join("\n");
}

const schemaDescription = `
Esquema lógico em Neo4j (grafo agregado):
(:Company {id, name})
  -[:HAS_SITE]-> (:Site {id, name})
  -[:HAS_DEVICE]-> (:LogicalDevice {id, logicalId, name})
  -[:HAS_DAILY]-> (:DailyMetric {day, kwh, avg_power, min_freq, max_freq, pf_avg})

Esquema relacional (Timescale/Postgres):
- companies(id)
- sites(id, company_id)
- logical_devices(id, site_id)
- daily_metrics(device_id, day, kwh, avg_power, min_freq, max_freq, pf_avg)

Observações importantes:
- A view daily_metrics já consolida o consumo diário (kwh) por device e dia.
- Não use CTEs em consultas que precisem virar continuous aggregates (só informação).
`.trim();

const hardRules = `
Regras de geração (obrigatórias):
1) Responda **apenas** um JSON válido: {"cypher":"...","sql":"..."} (sem texto fora do JSON).
2) Para **escopo de 1 empresa**:
   - Em **Cypher**: SEMPRE filtre por {id: $companyId}.
   - Em **SQL**: SEMPRE use $1 no WHERE para c.id=$1.
3) Datas no **Cypher**:
   - Nunca escreva "date() - 1" (isso é inválido). Use "date() - duration({days: 1})".
   - Exemplos:
     • Ontem e hoje: "date(m.day) IN [date(), date() - duration({days: 1})]".
     • Últimos 7 dias: "date(m.day) >= date() - duration({days: 7})".
     • Este mês: "date(m.day) >= date.truncate('month', date())".
     • Este ano: "date(m.day) >= date.truncate('year', date())".
4) Datas no **SQL** (Timescale/Postgres):
   - Ontem e hoje: "dm.day IN (CURRENT_DATE, CURRENT_DATE - INTERVAL '1 day')".
   - Últimos 7 dias: "dm.day >= CURRENT_DATE - INTERVAL '7 days'".
   - Este mês: "dm.day >= date_trunc('month', CURRENT_DATE)".
   - Este ano: "dm.day >= date_trunc('year', CURRENT_DATE)".
   - Intervalo explícito: "dm.day >= :start AND dm.day < :end" (o servidor pode substituir por parâmetros/safe literals).
5) Sempre que fizer agregação por dispositivo: GROUP BY d.id (SQL) e retorne d.id AS device_id / em Cypher d.id AS device_id.
6) Quando pedir "top" ou "maior", inclua ORDER BY apropriado + LIMIT.
7) Preserve nomes de colunas existentes: kwh, avg_power, min_freq, max_freq, pf_avg.
8) Quando for comparar "ano/mês/dia específicos", prefira filtros por igualdade de mês/ano ou por faixa (ex.: BETWEEN).
9) Gere **sempre os dois**: Cypher e SQL. Não explique, apenas forneça os campos no JSON.
`.trim();

const fewShots = [
  {
    question: "top consumo de ontem e hoje",
    json: `{"cypher":"MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(d:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)\\nWHERE date(m.day) IN [date(), date() - duration({days: 1})]\\nRETURN d.id AS device_id, sum(m.kwh) AS total_kwh\\nORDER BY total_kwh DESC\\nLIMIT 10","sql":"SELECT d.id AS device_id, COALESCE(SUM(dm.kwh),0) AS total_kwh\\nFROM companies c\\nJOIN sites s           ON s.company_id=c.id\\nJOIN logical_devices d ON d.site_id=s.id\\nJOIN daily_metrics dm  ON dm.device_id=d.id\\nWHERE c.id=$1\\n  AND dm.day IN (CURRENT_DATE, CURRENT_DATE - INTERVAL '1 day')\\nGROUP BY d.id\\nORDER BY total_kwh DESC\\nLIMIT 10"}`,
  },
  {
    question: "quanto eu gastei esse mês",
    json: `{"cypher":"MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)\\nWHERE date(m.day) >= date.truncate('month', date())\\nRETURN sum(m.kwh) AS total_kwh","sql":"SELECT COALESCE(SUM(dm.kwh),0) AS total_kwh\\nFROM companies c\\nJOIN sites s           ON s.company_id=c.id\\nJOIN logical_devices d ON d.site_id=s.id\\nJOIN daily_metrics dm  ON dm.device_id=d.id\\nWHERE c.id=$1\\n  AND dm.day >= date_trunc('month', CURRENT_DATE)"}`,
  },
  {
    question: "consumo entre 2025-09-01 e 2025-09-10",
    json: `{"cypher":"MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)\\nWHERE m.day >= date('2025-09-01') AND m.day < date('2025-09-11')\\nRETURN sum(m.kwh) AS total_kwh","sql":"SELECT COALESCE(SUM(dm.kwh),0) AS total_kwh\\nFROM companies c\\nJOIN sites s           ON s.company_id=c.id\\nJOIN logical_devices d ON d.site_id=s.id\\nJOIN daily_metrics dm  ON dm.device_id=d.id\\nWHERE c.id=$1\\n  AND dm.day >= DATE '2025-09-01'\\n  AND dm.day <  DATE '2025-09-11'"}`,
  },
  {
    question: "maior frequência este mês",
    json: `{"cypher":"MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)\\nWHERE date(m.day) >= date.truncate('month', date())\\nRETURN m.day AS dia, max(m.max_freq) AS frequencia_maxima\\nORDER BY frequencia_maxima DESC\\nLIMIT 1","sql":"SELECT dm.day AS dia, MAX(dm.max_freq) AS frequencia_maxima\\nFROM companies c\\nJOIN sites s           ON s.company_id=c.id\\nJOIN logical_devices d ON d.site_id=s.id\\nJOIN daily_metrics dm  ON dm.device_id=d.id\\nWHERE c.id=$1\\n  AND dm.day >= date_trunc('month', CURRENT_DATE)\\nGROUP BY dm.day\\nORDER BY frequencia_maxima DESC\\nLIMIT 1"}`,
  },
  {
    question: "quanto gastei em 2025",
    json: `{"cypher":"MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)\\nWHERE date(m.day) >= date.truncate('year', date('2025-01-01')) AND date(m.day) < date('2026-01-01')\\nRETURN sum(m.kwh) AS total_kwh_2025","sql":"SELECT COALESCE(SUM(dm.kwh),0) AS total_kwh_2025\\nFROM companies c\\nJOIN sites s           ON s.company_id=c.id\\nJOIN logical_devices d ON d.site_id=s.id\\nJOIN daily_metrics dm  ON dm.device_id=d.id\\nWHERE c.id=$1\\n  AND dm.day >= DATE '2025-01-01'\\n  AND dm.day <  DATE '2026-01-01'"}`,
  },
];

const baseInstructions = `
Você gera consultas para duas bases: Neo4j (Cypher) e Timescale/Postgres (SQL).
Gere **sempre** {"cypher":"...","sql":"..."}.
- **Cypher** deve seguir o grafo descrito no esquema lógico.
- **SQL** deve usar as tabelas/views: companies, sites, logical_devices, daily_metrics.
- Se a pergunta mencionar "ontem", "hoje", "este mês", "este ano", **SQL** normalmente é a fonte primária mais confiável, mas gere os dois.
`.trim();

export function buildPrompt({
  text,
  companyId,
  scope = "company",
  context = null, // { minDay, maxDay, companies: [...], note: '...' }
}) {
  const examples = fewShots
    .map(
      (ex) => `Usuário: ${ex.question}\nSaída:\n\`\`\`json\n${ex.json}\n\`\`\``
    )
    .join("\n\n");

  const footer =
    scope === "all" || !companyId
      ? `Usuário: ${text}\nEscopo: global (todas as empresas)`
      : `Usuário: ${text}\nEmpresa: ${companyId}`;

  const dynamicContext = context
    ? `\n\nContexto disponível:\n${renderContext(context)}`
    : "";

  return [
    baseInstructions,
    hardRules,
    schemaDescription,
    `Exemplos:\n\n${examples}`,
    `${footer}${dynamicContext}\n\nResponda somente com JSON {"cypher":"...","sql":"..."}`,
  ].join("\n\n");
}
