import cron from 'node-cron';
import { runSql } from '../db/timescale.js';
import { recordEvent } from '../events/store.js';
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (v instanceof Date) out[key] = v.toISOString();
    else if (typeof v === 'number' && !Number.isFinite(v)) out[key] = null;
    else if (v && typeof v === 'object') {
      try { out[key] = JSON.parse(JSON.stringify(v)); }
      catch { out[key] = String(v); }
    } else out[key] = v;
  }
  return out;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => normalizeRow(r));
}
import {
  listRules,
  getRuleById,
  recordRuleExecution
} from './store.js';

function buildSqlParams(rule) {
  if (!rule?.sql) return [];

  const tokens = Array.isArray(rule.sqlParams) ? rule.sqlParams : [];
  if (tokens.length > 0) {
    return tokens.map((token) => {
      if (token === '$COMPANY_ID') return rule.companyId;
      return token;
    });
  }

  if (/\$1\b/.test(rule.sql)) {
    return [rule.companyId];
  }

  return [];
}

function prepareResult(rows, limit = 100) {
  if (!Array.isArray(rows)) return [];
  if (rows.length <= limit) return rows;
  return rows.slice(0, limit);
}

export function createRuleManager({ log, hub }) {
  const scheduledJobs = new Map();
  const thresholdRules = new Map();
  const running = new Set();
  let thresholdTask = null;

  const stopJob = (id) => {
    const job = scheduledJobs.get(id);
    if (job) {
      job.stop();
      scheduledJobs.delete(id);
    }
  };

  const ensureThresholdTask = () => {
    if (thresholdRules.size === 0) {
      if (thresholdTask) {
        thresholdTask.stop();
        thresholdTask = null;
      }
      return;
    }

    if (!thresholdTask) {
      thresholdTask = cron.schedule('*/1 * * * *', runThresholdScan, {
        timezone: 'UTC'
      });
    }
  };

  const runThresholdScan = async () => {
    for (const rule of thresholdRules.values()) {
      await executeRule(rule.id, { rule });
    }
  };

  const broadcastResult = (rule, rows) => {
    const payload = {
      type: rule.type === 'threshold_alert' ? 'rule.alert' : 'rule.report',
      ruleId: rule.id,
      name: rule.name,
      companyId: rule.companyId,
      generatedAt: new Date().toISOString(),
      rows,
      metadata: rule.metadata ?? {}
    };

    try {
      recordEvent(rule.companyId, payload);
    } catch (err) {
      log.warn({ err, ruleId: rule.id }, 'Falha ao registrar evento recente da regra');
    }

    try {
      hub.broadcast(rule.companyId, payload);
    } catch (err) {
      log.error({ err, ruleId: rule.id }, 'Falha ao transmitir resultado da regra');
    }
  };

  const executeRule = async (ruleId, { rule: providedRule } = {}) => {
    if (running.has(ruleId)) {
      log.debug({ ruleId }, 'Execução ignorada: tarefa anterior ainda em andamento');
      return;
    }

    let rule = providedRule;
    running.add(ruleId);
    try {
      if (!rule) {
        rule = await getRuleById(ruleId);
      }
      if (!rule) {
        return;
      }
      if (rule.status !== 'active') {
        return;
      }

      const params = buildSqlParams(rule);
      const result = await runSql(rule.sql, params);
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const trimmed = prepareResult(rows);\n      const normalized = normalizeRows(trimmed);
      const triggered = rule.type === 'threshold_alert' ? rows.length > 0 : true;

      await recordRuleExecution({
        id: rule.id,
        lastResult: triggered ? normalized : [],
        triggered
      });

      if (triggered) {
        broadcastResult(rule, normalized);
      }
    } catch (err) {
      log.error({ err, ruleId }, 'Falha ao executar regra');
      await recordRuleExecution({
        id: ruleId,
        lastResult: { error: err.message },
        triggered: false
      });
    } finally {
      running.delete(ruleId);
    }
  };

  const addRule = (rule) => {
    if (!rule || rule.status !== 'active') {
      return;
    }

    if (rule.type === 'schedule_report') {
      if (!rule.scheduleCron || !cron.validate(rule.scheduleCron)) {
        log.warn({ ruleId: rule.id }, 'Cron inválido para regra agendada, ignorando');
        return;
      }

      stopJob(rule.id);
      const task = cron.schedule(rule.scheduleCron, () => executeRule(rule.id, { rule }), {
        timezone: 'UTC'
      });
      scheduledJobs.set(rule.id, task);
      log.info({ ruleId: rule.id }, 'Regra agendada registrada');
    } else if (rule.type === 'threshold_alert') {
      thresholdRules.set(rule.id, rule);
      ensureThresholdTask();
      log.info({ ruleId: rule.id }, 'Regra de alerta contínuo registrada');
    }
  };

  const removeRule = (ruleId) => {
    stopJob(ruleId);
    thresholdRules.delete(ruleId);
    ensureThresholdTask();
  };

  const reloadRule = async (ruleId) => {
    removeRule(ruleId);
    const fresh = await getRuleById(ruleId);
    if (fresh) {
      addRule(fresh);
    }
  };

  const start = async () => {
    const rules = await listRules();
    for (const rule of rules) {
      addRule(rule);
    }
  };

  const stop = async () => {
    for (const job of scheduledJobs.values()) {
      job.stop();
    }
    scheduledJobs.clear();

    if (thresholdTask) {
      thresholdTask.stop();
      thresholdTask = null;
    }
    thresholdRules.clear();
  };

  return {
    start,
    stop,
    addRule,
    removeRule,
    reloadRule,
    executeRule,
    broadcastResult
  };
}


