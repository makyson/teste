import { AnySchedule } from "../schedule/types";
import { pool } from "./db";

export async function upsertPolicy({
  id,
  title,
  body,
  model,
  rulesSystem,
}: {
  id: string;
  title: string;
  body: string;
  model: string;
  rulesSystem: string;
}) {
  await pool.query(
    `INSERT INTO admin_policies (id, title, body, model, rules_system)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (id) DO UPDATE SET
title=EXCLUDED.title,
body=EXCLUDED.body,
model=EXCLUDED.model,
rules_system=EXCLUDED.rules_system`,
    [id, title, body, model, rulesSystem]
  );
}

export async function listPolicyCaches(policyId: string) {
  const r = await pool.query(
    `SELECT id as version_id, gemini_cache_name, model, ttl_seconds, expires_at
FROM policy_caches WHERE policy_id=$1
ORDER BY created_at DESC`,
    [policyId]
  );
  return r.rows;
}

export async function saveSchedule(s: AnySchedule & { nextAt?: Date | null }) {
  const payload = { ...s } as any;
  delete payload.id;
  delete payload.name;
  delete payload.tz;
  delete payload.enabled;
  delete payload.excludeDates;

  await pool.query(
    `INSERT INTO schedules (id,name,tz,kind,payload,enabled,exclude_dates,next_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
 ON CONFLICT (id) DO UPDATE SET
 name=EXCLUDED.name, tz=EXCLUDED.tz, kind=EXCLUDED.kind, payload=EXCLUDED.payload,
 enabled=EXCLUDED.enabled, exclude_dates=EXCLUDED.exclude_dates, next_at=EXCLUDED.next_at,
 updated_at=now()`,
    [
      s.id,
      s.name,
      s.tz,
      s.kind,
      payload,
      s.enabled,
      s.excludeDates ?? [],
      s.nextAt ?? null,
    ]
  );
}

export async function listDue(limit = 500, now = new Date()) {
  const r = await pool.query(
    `SELECT id FROM schedules WHERE enabled = true AND next_at IS NOT NULL AND next_at <= $1
     ORDER BY next_at ASC LIMIT $2`,
    [now, limit]
  );
  return r.rows.map((x: any) => x.id as string);
}

export async function loadSchedule(id: string) {
  const r = await pool.query(`SELECT * FROM schedules WHERE id=$1`, [id]);
  return r.rowCount ? r.rows[0] : null;
}

export async function setNextAt(id: string, nextAt: Date | null) {
  await pool.query(
    `UPDATE schedules SET next_at=$2, updated_at=now() WHERE id=$1`,
    [id, nextAt]
  );
}
