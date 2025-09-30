const schemaDescription = `
Esquema lógico em Neo4j:
(:Company {id, name})-[:HAS_SITE]->(:Site {id, name})-[:HAS_DEVICE]->(:LogicalDevice {id, logicalId, name})-[:HAS_DAILY]->(:DailyMetric {day, kwh, avg_power, min_freq, max_freq, pf_avg})
(:Rule {id, name})-[:FIRED]->(:Alert {id, created_at, severity})
`;

const instructions = `
Você é um assistente especializado em gerar consultas Cypher para Neo4j.
Responda SEMPRE apenas com a consulta Cypher, sem texto adicional, sem explicações e sem blocos de código.
Utilize sempre parâmetros nomeados e filtre pela empresa informada usando MATCH (c:Company {id: $companyId}).
Use as relações do esquema para navegar até métricas diárias (:DailyMetric).
Prefira retornar colunas nomeadas em snake_case.
`;

const fewShots = [
  {
    question: 'quero o resumo desse mês',
    cypher: `MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(d:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)
WHERE date(m.day) >= date.truncate('month', date())
RETURN d.id AS device_id,
       sum(m.kwh) AS total_kwh,
       avg(m.avg_power) AS media_potencia,
       avg(m.pf_avg) AS fator_potencia_medio
ORDER BY total_kwh DESC`
  },
  {
    question: 'qual aparelho consumiu mais nos últimos 30 dias?',
    cypher: `MATCH (c:Company {id: $companyId})-[:HAS_SITE]->(:Site)-[:HAS_DEVICE]->(d:LogicalDevice)-[:HAS_DAILY]->(m:DailyMetric)
WHERE m.day >= date() - duration({days: 30})
RETURN d.id AS device_id,
       sum(m.kwh) AS consumo_total_kwh
ORDER BY consumo_total_kwh DESC
LIMIT 1`
  },
  {
    question: 'listar alertas críticos do último mês',
    cypher: `MATCH (c:Company {id: $companyId})<-[:FIRED]-(:Rule)-[:FIRED]->(a:Alert)
WHERE a.severity = 'critical' AND a.created_at >= datetime() - duration({days: 30})
RETURN a.id AS alert_id,
       a.severity AS severidade,
       a.created_at AS criado_em
ORDER BY a.created_at DESC`
  }
];

export function buildPrompt({ text, companyId }) {
  const examples = fewShots
    .map((example) => `Usuário: ${example.question}\nCypher: ${example.cypher}`)
    .join('\n\n');

  return [
    instructions.trim(),
    schemaDescription.trim(),
    examples,
    `Usuário: ${text}\nEmpresa: ${companyId}\nCypher:`
  ]
    .filter(Boolean)
    .join('\n\n');
}
