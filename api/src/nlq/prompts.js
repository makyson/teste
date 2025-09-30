// src/nlq/prompts.js
const schemaDescription = `
Esquema lógico em Neo4j:
(:Company {id, name})-[:HAS_SITE]->(:Site {id, name})-[:HAS_DEVICE]->(:LogicalDevice {id, logicalId, name})-[:HAS_DAILY]->(:DailyMetric {day, kwh, avg_power, min_freq, max_freq, pf_avg})
(:Rule {id, name})-[:FIRED]->(:Alert {id, created_at, severity})
`;

const instructions = `
Você gera consultas para duas bases:
1) Neo4j (Cypher)
2) Timescale/Postgres (SQL)

Responda **apenas** um JSON válido: {"cypher":"...","sql":"..."}.
- Para **Cypher**: siga o esquema acima.
- Para **SQL**: assuma tabelas: companies(id), sites(id, company_id), logical_devices(id, site_id), daily_metrics(device_id, day, kwh, avg_power, min_freq, max_freq, pf_avg).

Escopo:
- Se o pedido for sobre **uma** empresa, filtrar por $companyId na Cypher e usar **$1** no SQL.
- Se o pedido for **todas** as empresas, **não** filtrar por empresa e agrupar por company_id/c.id quando fizer sentido.
`;

const fewShots = [
  {
    question: 'quero o resumo desse mês',
    json: `{"cypher":"MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(d:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)\\nWHERE date(m.day) >= date.truncate('month', date())\\nRETURN d.id AS device_id, sum(m.kwh) AS total_kwh, avg(m.avg_power) AS media_potencia, avg(m.pf_avg) AS fator_potencia_medio\\nORDER BY total_kwh DESC","sql":"SELECT d.id AS device_id, COALESCE(SUM(dm.kwh),0) AS total_kwh, AVG(dm.avg_power) AS media_potencia, AVG(dm.pf_avg) AS fator_potencia_medio FROM companies c JOIN sites s ON s.company_id=c.id JOIN logical_devices d ON d.site_id=s.id JOIN daily_metrics dm ON dm.device_id=d.id WHERE c.id=$1 AND dm.day >= date_trunc('month', CURRENT_DATE) GROUP BY d.id ORDER BY total_kwh DESC"}`
  },
  {
    question: 'consumo total por empresa neste mês (todas as empresas)',
    json: `{"cypher":"MATCH (c:Company)-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)\\nWHERE date(m.day) >= date.truncate('month', date())\\nRETURN c.id AS company_id, sum(m.kwh) AS total_kwh\\nORDER BY total_kwh DESC","sql":"SELECT c.id AS company_id, COALESCE(SUM(dm.kwh),0) AS total_kwh FROM companies c JOIN sites s ON s.company_id=c.id JOIN logical_devices d ON d.site_id=s.id JOIN daily_metrics dm ON dm.device_id=d.id WHERE dm.day >= date_trunc('month', CURRENT_DATE) GROUP BY c.id ORDER BY total_kwh DESC"}`
  }
];

export function buildPrompt({ text, companyId, scope = 'company' }) {
  const examples = fewShots
    .map((ex) => `Usuário: ${ex.question}\nSaída:\n\`\`\`json\n${ex.json}\n\`\`\``)
    .join('\n\n');

  const footer =
    scope === 'all' || !companyId
      ? `Usuário: ${text}\nEscopo: global (todas as empresas)`
      : `Usuário: ${text}\nEmpresa: ${companyId}`;

  return [
    instructions.trim(),
    schemaDescription.trim(),
    examples,
    `${footer}\nResponda somente com JSON {"cypher":"...","sql":"..."}`
  ].join('\n\n');
}
