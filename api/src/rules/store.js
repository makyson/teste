import pool from '../db/timescale.js';

function asJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function mapRuleRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    type: row.type,
    status: row.status,
    scheduleCron: row.schedule_cron,
    prompt: row.prompt,
    cypher: row.cypher,
    sql: row.sql,
    sqlParams: asJson(row.sql_params, []),
    metadata: asJson(row.metadata, {}),
    lastRunAt: row.last_run_at,
    lastResult: asJson(row.last_result, null),
    lastTriggeredAt: row.last_triggered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listRules({ companyId } = {}) {
  const where = [];
  const params = [];

  if (companyId) {
    where.push('company_id = $1');
    params.push(companyId);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT * FROM nlq_rules ${clause} ORDER BY created_at DESC`,
    params
  );

  return result.rows.map(mapRuleRow);
}

export async function getRuleById(id) {
  const result = await pool.query(
    'SELECT * FROM nlq_rules WHERE id = $1',
    [id]
  );
  return mapRuleRow(result.rows[0]);
}

export async function createRule(data) {
  const {
    companyId,
    name,
    description = null,
    type,
    status = 'inactive',
    scheduleCron = null,
    prompt,
    cypher = null,
    sql = null,
    sqlParams = [],
    metadata = {}
  } = data;

  const result = await pool.query(
    `INSERT INTO nlq_rules (
       company_id, name, description, type, status, schedule_cron, prompt, cypher, sql, sql_params, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      companyId,
      name,
      description,
      type,
      status,
      scheduleCron,
      prompt,
      cypher,
      sql,
      JSON.stringify(sqlParams ?? []),
      JSON.stringify(metadata ?? {})
    ]
  );

  return mapRuleRow(result.rows[0]);
}

export async function updateRule(id, data) {
  const fields = [];
  const values = [];
  let index = 1;

  const pushField = (column, value, transform = (v) => v) => {
    if (value === undefined) return;
    fields.push(`${column} = $${index}`);
    values.push(transform(value));
    index += 1;
  };

  pushField('name', data.name);
  pushField('description', data.description);
  pushField('type', data.type);
  pushField('status', data.status);
  pushField('schedule_cron', data.scheduleCron);
  pushField('prompt', data.prompt);
  pushField('cypher', data.cypher);
  pushField('sql', data.sql);
  pushField('sql_params', data.sqlParams, (value) => JSON.stringify(value ?? []));
  pushField('metadata', data.metadata, (value) => JSON.stringify(value ?? {}));
  pushField('updated_at', new Date().toISOString());

  if (!fields.length) {
    return getRuleById(id);
  }

  values.push(id);

  const query = `UPDATE nlq_rules SET ${fields.join(', ')} WHERE id = $${index} RETURNING *`;
  const result = await pool.query(query, values);
  return mapRuleRow(result.rows[0]);
}

export async function deleteRule(id) {
  await pool.query('DELETE FROM nlq_rules WHERE id = $1', [id]);
}

export async function setRuleStatus(id, status) {
  const result = await pool.query(
    'UPDATE nlq_rules SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, id]
  );
  return mapRuleRow(result.rows[0]);
}

export async function recordRuleExecution({ id, lastResult = null, triggered = false }) {
  const result = await pool.query(
    `UPDATE nlq_rules
        SET last_run_at = NOW(),
            last_result = $1,
            last_triggered_at = CASE WHEN $2 THEN NOW() ELSE last_triggered_at END,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [lastResult == null ? null : JSON.stringify(lastResult), triggered, id]
  );
  return mapRuleRow(result.rows[0]);
}
