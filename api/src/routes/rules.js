import cron from 'node-cron';
import {
  createRule,
  listRules,
  getRuleById,
  updateRule,
  deleteRule,
  setRuleStatus
} from '../rules/store.js';
import { generateQueries } from '../nlq/gemini.js';
import { patchNaiveDateSubtractions } from '../nlq/cypherFixes.js';

function resolveCompanyId(request, explicit) {
  const tokenCompany = request.user?.companyId;
  if (explicit && tokenCompany && explicit !== tokenCompany) {
    const err = new Error('FORBIDDEN_COMPANY');
    err.statusCode = 403;
    err.code = 'FORBIDDEN_COMPANY';
    throw err;
  }
  const value = explicit ?? tokenCompany ?? request.server.config.defaultCompanyId;
  return typeof value === 'string' && value.length ? value : request.server.config.defaultCompanyId;
}

function ensureOwnership(rule, request) {
  const tokenCompany = request.user?.companyId;
  if (!tokenCompany) return true;
  return rule.companyId === tokenCompany;
}

function mapRule(rule) {
  if (!rule) return null;
  return {
    id: rule.id,
    companyId: rule.companyId,
    name: rule.name,
    description: rule.description,
    type: rule.type,
    status: rule.status,
    scheduleCron: rule.scheduleCron,
    prompt: rule.prompt,
    cypher: rule.cypher,
    sql: rule.sql,
    sqlParams: rule.sqlParams,
    metadata: rule.metadata,
    lastRunAt: rule.lastRunAt,
    lastResult: rule.lastResult,
    lastTriggeredAt: rule.lastTriggeredAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
  };
}

async function generateRuleQueries({ text, companyId }) {
  const generated = await generateQueries({ text, companyId });
  const cypher = patchNaiveDateSubtractions(generated?.cypher ?? '');
  const sql = generated?.sql ?? '';
  return { cypher, sql };
}

function inferSqlParams(sql, provided) {
  if (Array.isArray(provided) && provided.length) {
    return provided;
  }
  if (typeof sql === 'string' && /\$1\b/.test(sql)) {
    return ['$COMPANY_ID'];
  }
  return [];
}

export default async function registerRulesRoutes(fastify) {
  fastify.register(async (instance) => {
    instance.addHook('preHandler', fastify.authenticate);

    instance.get('/rules', {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            companyId: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    }, async (request, reply) => {
      let companyId;
      try {
        companyId = resolveCompanyId(request, request.query?.companyId);
      } catch (err) {
        if (err.code === 'FORBIDDEN_COMPANY') {
          reply.code(403);
          return { code: 'FORBIDDEN', message: 'Acesso negado à empresa informada.' };
        }
        throw err;
      }

      const rules = await listRules({ companyId });
      const filtered = request.query?.status
        ? rules.filter((rule) => rule.status === request.query.status)
        : rules;
      return { items: filtered.map(mapRule) };
    });

    instance.get('/rules/:id', async (request, reply) => {
      const rule = await getRuleById(request.params.id);
      if (!rule) {
        reply.code(404);
        return { code: 'RULE_NOT_FOUND', message: 'Regra não encontrada.' };
      }

      if (!ensureOwnership(rule, request)) {
        reply.code(403);
        return { code: 'FORBIDDEN', message: 'Você não pode acessar regras de outra empresa.' };
      }

      return mapRule(rule);
    });

    instance.post('/rules', {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'type', 'prompt'],
          properties: {
            name: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            type: { type: 'string', enum: ['schedule_report', 'threshold_alert'] },
            prompt: { type: 'string', minLength: 5 },
            scheduleCron: { type: 'string' },
            metadata: { type: 'object' },
            companyId: { type: 'string' },
            activate: { type: 'boolean' }
          }
        }
      }
    }, async (request, reply) => {
      const {
        name,
        description,
        type,
        prompt,
        scheduleCron,
        metadata = {},
        companyId: bodyCompanyId,
        activate = false
      } = request.body;

      let companyId;
      try {
        companyId = resolveCompanyId(request, bodyCompanyId);
      } catch (err) {
        if (err.code === 'FORBIDDEN_COMPANY') {
          reply.code(403);
          return { code: 'FORBIDDEN', message: 'Você não pode criar regras para outra empresa.' };
        }
        throw err;
      }

      if (type === 'schedule_report') {
        if (!scheduleCron || !cron.validate(scheduleCron)) {
          reply.code(400);
          return {
            code: 'INVALID_CRON',
            message: 'scheduleCron invÃ¡lido para regra agendada.'
          };
        }
      }

      const { cypher, sql } = await generateRuleQueries({ text: prompt, companyId });
      const sqlParams = inferSqlParams(sql, metadata?.sqlParams);

      const rule = await createRule({
        companyId,
        name,
        description,
        type,
        prompt,
        scheduleCron: type === 'schedule_report' ? scheduleCron : null,
        cypher,
        sql,
        sqlParams,
        metadata
      });

      let finalRule = rule;

      if (activate) {
        finalRule = await setRuleStatus(rule.id, 'active');
        if (fastify.ruleManager) {
          await fastify.ruleManager.reloadRule(finalRule.id);
        }
      }

      reply.code(201);
      return mapRule(finalRule);
    });

    instance.patch('/rules/:id', async (request, reply) => {
      const rule = await getRuleById(request.params.id);
      if (!rule) {
        reply.code(404);
        return { code: 'RULE_NOT_FOUND', message: 'Regra não encontrada.' };
      }

      if (!ensureOwnership(rule, request)) {
        reply.code(403);
        return { code: 'FORBIDDEN', message: 'Você não pode alterar regras de outra empresa.' };
      }

      const payload = request.body ?? {};
      const updateData = { ...payload };

      if (payload.scheduleCron) {
        if (!cron.validate(payload.scheduleCron)) {
          reply.code(400);
          return { code: 'INVALID_CRON', message: 'scheduleCron inválido.' };
        }
      }

      if (payload.prompt) {
        let companyId;
        try {
          companyId = resolveCompanyId(request, payload.companyId ?? rule.companyId);
        } catch (err) {
          if (err.code === 'FORBIDDEN_COMPANY') {
            reply.code(403);
            return { code: 'FORBIDDEN', message: 'Você não pode alterar a empresa da regra.' };
          }
          throw err;
        }
        const { cypher, sql } = await generateRuleQueries({ text: payload.prompt, companyId });
        updateData.cypher = cypher;
        updateData.sql = sql;
        updateData.sqlParams = inferSqlParams(sql, payload.metadata?.sqlParams ?? rule.sqlParams);
      }

      const updated = await updateRule(rule.id, {
        ...updateData,
        companyId: undefined
      });

      if (fastify.ruleManager) {
        await fastify.ruleManager.reloadRule(updated.id);
      }

      return mapRule(updated);
    });

    instance.post('/rules/:id/activate', async (request, reply) => {
      const rule = await getRuleById(request.params.id);
      if (!rule) {
        reply.code(404);
        return { code: 'RULE_NOT_FOUND', message: 'Regra nÃ£o encontrada.' };

      if (!ensureOwnership(rule, request)) {
        reply.code(403);
        return { code: 'FORBIDDEN', message: 'Você não pode alterar regras de outra empresa.' };
      }
      }

      const updated = await setRuleStatus(rule.id, 'active');
      if (fastify.ruleManager) {
        await fastify.ruleManager.reloadRule(updated.id);
      }
      return mapRule(updated);
    });

    instance.post('/rules/:id/deactivate', async (request, reply) => {
      const rule = await getRuleById(request.params.id);
      if (!rule) {
        reply.code(404);
        return { code: 'RULE_NOT_FOUND', message: 'Regra nÃ£o encontrada.' };

      if (!ensureOwnership(rule, request)) {
        reply.code(403);
        return { code: 'FORBIDDEN', message: 'Você não pode alterar regras de outra empresa.' };
      }
      }

      const updated = await setRuleStatus(rule.id, 'inactive');
      if (fastify.ruleManager) {
        fastify.ruleManager.removeRule(updated.id);
      }
      return mapRule(updated);
    });

    instance.delete('/rules/:id', async (request, reply) => {
      const rule = await getRuleById(request.params.id);
      if (!rule) {
        reply.code(404);
        return { code: 'RULE_NOT_FOUND', message: 'Regra nÃ£o encontrada.' };

      if (!ensureOwnership(rule, request)) {
        reply.code(403);
        return { code: 'FORBIDDEN', message: 'Você não pode alterar regras de outra empresa.' };
      }
      }

      await deleteRule(rule.id);
      if (fastify.ruleManager) {
        fastify.ruleManager.removeRule(rule.id);
      }

      reply.code(204);
    });
  });
}
