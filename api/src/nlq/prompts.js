// src/nlq/prompts.js

// 👉 Helper opcional: passe um "contexto" real lido do Timescale/Neo4j
// Ex.: { minDay: '2025-09-01', maxDay: '2025-09-10', companies: ['company-1'] }
export function renderContext(ctx = {}) {
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
- daily_metrics(company_id, site_id, device_id, day, kwh, avg_power, min_freq, max_freq, pf_avg)
- telemetry_raw(company_id, logical_id, ts, voltage, current, frequency, power_factor, payload)

Observações importantes:
- Não invente nomes de colunas fora desta lista (ex.: use d.id, nunca d.logicalId).
- A view daily_metrics já consolida o consumo diário (kwh) por device e dia.
- Para janelas de minutos/horas recentes, utilize telemetry_raw com filtros em ts (ex.: ts BETWEEN now() - INTERVAL '5 minutes' AND now()). Sempre retorne colunas reais da leitura, sem mensagens estáticas.
- Potências e energias podem ter valores baixos (Watts/kWh pequenos) porque vêm de telemetria real.
\n- Não use CTEs em consultas que precisem virar continuous aggregates (só informação).
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
7) Preserve nomes de colunas existentes: id, device_id, site_id, company_id, kwh, avg_power, min_freq, max_freq, pf_avg (snake_case).
8) Quando for comparar "ano/mês/dia específicos", prefira filtros por igualdade de mês/ano ou por faixa (ex.: BETWEEN).
9) Gere **sempre os dois**: Cypher e SQL. Não explique, apenas forneça os campos no JSON.
10) Nunca escreva consultas do tipo \`WITH (SELECT ...) AS alias\`. Use CTEs nomeadas (ex.: \`WITH total AS (...), top AS (...) SELECT ... FROM total CROSS JOIN top\`).
11) Quando a pergunta indicar uma regra agendada ou recorrência, assuma janelas relativas ao presente (ex.: use ts <= now() e o intervalo apropriado) e deixe claro no SQL/Cypher que o recorte termina em now().
12) Nunca substitua resultados por mensagens fixas ou strings literais. Sempre escreva consultas que retornem dados reais das tabelas disponíveis.
13) Para perguntas sobre "consumo deste mês" (sinônimos: "gasto este mês", "kWh deste mês", "energia do mês atual"), a **SQL** deve retornar, por dispositivo, **exatamente** as colunas e aliases:
   device_id, "avgConsumo", "avgVoltage", "avgCurrent", "avgFrequency", "avgPowerFactor", "avgAcumulado".
   Definições:
   - "avgConsumo" = AVG(dm.kwh) no mês (média diária em kWh/dia).
   - "avgAcumulado" = SUM(dm.kwh) no mês (kWh do mês).
   - As médias de tensão/corrente/frequência/fator de potência vêm de telemetry_raw **do mês corrente**.
   Use \`c.id = $1\` e recorte de data com \`date_trunc('month', CURRENT_DATE)\`/\`now()\`.
   No **Cypher**, retorne o que o grafo suportar (ex.: kwh/pf_avg), preservando ao menos \`device_id\`,\`avgConsumo\`, \`avgAcumulado\`.
   `.trim();

const fewShots = [];

const baseInstructions = `
Você gera consultas para duas bases: Neo4j (Cypher) e Timescale/Postgres (SQL).
Gere **sempre** {"cypher":"...","sql":"..."}.
- **Cypher** deve seguir o grafo descrito no esquema lógico.
- **SQL** deve usar exclusivamente as views/tabelas autorizadas: companies, sites, logical_devices, daily_metrics, telemetry_raw (com os nomes exatos das colunas). Para períodos de minutos/horas recentes, prefira telemetry_raw e filtre por ts.
- Se a pergunta mencionar "ontem", "hoje", "este mês", "este ano", **SQL** normalmente é a fonte primária mais confiável, mas gere os dois.
`.trim();

// ===== export para uso com Caching API =====
export function buildSystemInstruction() {
  const examples = fewShots
    .map(
      (ex) => `Usuário: ${ex.question}\nSaída:\n\`\`\`json\n${ex.json}\n\`\`\``
    )
    .join("\n\n");

  return [
    baseInstructions,
    hardRules,
    schemaDescription,
    `Exemplos:\n\n${examples}`,
    `Responda somente com JSON {"cypher":"...","sql":"..."}`,
  ].join("\n\n");
}

export function buildUserFooter({
  text,
  companyId,
  scope = "company",
  context = null, // { minDay, maxDay, companies: [...], note: '...' }
}) {
  const footer =
    scope === "all" || !companyId
      ? `Usuário: ${text}\nEscopo: global (todas as empresas)`
      : `Usuário: ${text}\nEmpresa: ${companyId}`;

  const dynamicContext = context
    ? `\n\nContexto disponível:\n${renderContext(context)}`
    : "";

  // Nota: a instrução de "responda só JSON" já está no system cache
  return `${footer}${dynamicContext}`;
}

// ===== compat: prompt monolítico antigo (se quiser manter chamadas antigas) ====
export function buildPrompt({
  text,
  companyId,
  scope = "company",
  context = null,
}) {
  const sys = buildSystemInstruction();
  const tail = buildUserFooter({ text, companyId, scope, context });
  return `${sys}\n\n${tail}\n\nResponda somente com JSON {"cypher":"...","sql":"..."}`;
}
