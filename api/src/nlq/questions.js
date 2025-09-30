import { runCypher } from '../db/neo4j.js';

const DEFAULT_APPROVAL_THRESHOLD = 0.8;
const GLOBAL_COMPANY_KEY = '__global__';

function normalizeCompanyKey(companyId) {
  return companyId && companyId.length > 0 ? companyId : GLOBAL_COMPANY_KEY;
}

function mapNode(node) {
  if (!node) {
    return null;
  }

  const { properties } = node;

  return {
    text: properties.text,
    normalizedText: properties.normalizedText,
    cypher: properties.cypher,
    approval: typeof properties.approval?.toNumber === 'function'
      ? properties.approval.toNumber()
      : properties.approval,
    companyId: properties.companyKey === GLOBAL_COMPANY_KEY ? null : properties.companyKey,
    companyKey: properties.companyKey
  };
}

export async function findApprovedQuestion({
  normalizedText,
  companyId,
  threshold = DEFAULT_APPROVAL_THRESHOLD
}) {
  const companyKey = normalizeCompanyKey(companyId);
  const params = {
    normalizedText,
    companyKey,
    threshold,
    globalKey: GLOBAL_COMPANY_KEY
  };

  const query = `
MATCH (q:NlqQuestion { normalizedText: $normalizedText, companyKey: $companyKey })
WHERE coalesce(q.approval, 0) >= $threshold
RETURN q
ORDER BY q.updatedAt DESC
LIMIT 1
`;

  const result = await runCypher(query, params);
  if (result.records.length) {
    return mapNode(result.records[0].get('q'));
  }

  if (companyKey === GLOBAL_COMPANY_KEY) {
    return null;
  }

  const fallback = await runCypher(
    `
MATCH (q:NlqQuestion { normalizedText: $normalizedText, companyKey: $globalKey })
WHERE coalesce(q.approval, 0) >= $threshold
RETURN q
ORDER BY q.updatedAt DESC
LIMIT 1
    `,
    params
  );

  if (!fallback.records.length) {
    return null;
  }

  return mapNode(fallback.records[0].get('q'));
}

export async function registerQuestionUsage({ normalizedText, companyId }) {
  const companyKey = normalizeCompanyKey(companyId);
  const now = new Date().toISOString();

  await runCypher(
    `
MATCH (q:NlqQuestion { normalizedText: $normalizedText, companyKey: $companyKey })
SET q.lastUsedAt = datetime($now),
    q.updatedAt = datetime($now),
    q.usageCount = coalesce(q.usageCount, 0) + 1
RETURN q
    `,
    {
      normalizedText,
      companyKey,
      now
    }
  );
}

export async function registerQuestionSuccess({
  text,
  normalizedText,
  companyId,
  cypher,
  approval = 1
}) {
  const companyKey = normalizeCompanyKey(companyId);
  const now = new Date().toISOString();

  await runCypher(
    `
MERGE (q:NlqQuestion { normalizedText: $normalizedText, companyKey: $companyKey })
ON CREATE SET
  q.text = $text,
  q.cypher = $cypher,
  q.approval = $approval,
  q.companyId = $companyId,
  q.createdAt = datetime($now),
  q.updatedAt = datetime($now),
  q.lastUsedAt = datetime($now),
  q.usageCount = 1
ON MATCH SET
  q.text = $text,
  q.cypher = $cypher,
  q.approval = CASE WHEN $approval > coalesce(q.approval, 0) THEN $approval ELSE q.approval END,
  q.companyId = $companyId,
  q.updatedAt = datetime($now),
  q.lastUsedAt = datetime($now),
  q.usageCount = coalesce(q.usageCount, 0) + 1
RETURN q
    `,
    {
      text,
      normalizedText,
      companyKey,
      companyId,
      cypher,
      approval,
      now
    }
  );
}

export { DEFAULT_APPROVAL_THRESHOLD };
