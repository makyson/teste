import { generateCypher } from '../nlq/gemini.js';
import { runCypher } from '../db/neo4j.js';
import {
  DEFAULT_APPROVAL_THRESHOLD,
  findApprovedQuestion,
  registerQuestionSuccess,
  registerQuestionUsage
} from '../nlq/questions.js';

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeForSearch(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildAnswer(rows, companyId) {
  if (!rows.length) {
    return `Nenhum resultado encontrado para a empresa ${companyId}.`;
  }

  const sample = rows[0];
  const keys = Object.keys(sample);
  if (!keys.length) {
    return `Consulta executada com sucesso para a empresa ${companyId}, porém não há colunas retornadas.`;
  }

  const preview = keys
    .slice(0, 5)
    .map((key) => `${key}: ${sample[key]}`)
    .join(', ');

  if (rows.length === 1) {
    return `Encontrada 1 linha para a empresa ${companyId}. Principais valores: ${preview}.`;
  }

  return `Encontradas ${rows.length} linhas para a empresa ${companyId}. Exemplo de linha: ${preview}.`;
}

export default async function registerNlqRoutes(fastify) {
  fastify.post('/nlq/query', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1 },
          companyId: { type: 'string', minLength: 1 }
        }
      }
    },
    handler: async (request, reply) => {
      const { text, companyId } = request.body;
      const normalizedText = normalizeText(text);
      if (!normalizedText) {
        reply.code(400);
        return {
          code: 'INVALID_TEXT',
          message: 'O campo "text" deve ser uma string não vazia.'
        };
      }

      codex/automatizar-geracao-de-sql
      const targetCompanyId = normalizeText(companyId) || fastify.config.defaultCompanyId;
      const normalizedSearchText = normalizeForSearch(normalizedText);

      const tokenCompanyId = request.user?.companyId;
      const targetCompanyId =
        normalizeText(companyId) ||
        normalizeText(tokenCompanyId) ||
        fastify.config.defaultCompanyId;
        main
      const start = Date.now();

      let cypher;
      let source = 'gemini';
      const approvalThreshold = Number.isFinite(fastify.config?.nlq?.approvalThreshold)
        ? fastify.config.nlq.approvalThreshold
        : DEFAULT_APPROVAL_THRESHOLD;

      try {
        const stored = await findApprovedQuestion({
          normalizedText: normalizedSearchText,
          companyId: targetCompanyId,
          threshold: approvalThreshold
        });

        if (stored) {
          cypher = stored.cypher;
          source = 'catalog';
          await registerQuestionUsage({
            normalizedText: normalizedSearchText,
            companyId: stored.companyKey ?? targetCompanyId
          });
        }
      } catch (err) {
        fastify.log.error({ err }, 'Falha ao buscar pergunta aprovada no Neo4j');
      }

      if (!cypher) {
        try {
          cypher = await generateCypher({
            text: normalizedText,
            companyId: targetCompanyId
          });
        } catch (err) {
          fastify.log.error({ err }, 'Erro ao gerar Cypher via Gemini');
          reply.code(502);
          return {
            code: 'GEMINI_ERROR',
            message: 'Não foi possível gerar a consulta a partir do texto informado.'
          };
        }
      }

      let rows;
      try {
        const result = await runCypher(cypher, { companyId: targetCompanyId });
        rows = result.records.map((record) => record.toObject());
      } catch (err) {
        fastify.log.error({ err, cypher }, 'Erro ao executar Cypher');
        reply.code(500);
        return {
          code: 'NEO4J_ERROR',
          message: 'Falha ao executar consulta no grafo.'
        };
      }

      if (source === 'gemini') {
        try {
          await registerQuestionSuccess({
            text: normalizedText,
            normalizedText: normalizedSearchText,
            companyId: targetCompanyId,
            cypher
          });
        } catch (err) {
          fastify.log.error({ err }, 'Falha ao salvar pergunta NLQ no Neo4j');
        }
      }

      const total = Date.now() - start;
      fastify.log.info({ cypher, totalMs: total, source }, 'NLQ executado');

      return {
        answer: buildAnswer(rows, targetCompanyId),
        cypher,
        rows,
        source
      };
    }
  });
}
