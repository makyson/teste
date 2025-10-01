// src/routes/nlq.js
import { generateQueries } from '../nlq/gemini.js';
import { runCypher } from '../db/neo4j.js';
import { runSql } from '../db/timescale.js';
import {
  DEFAULT_APPROVAL_THRESHOLD,
  findApprovedQuestion,
  registerQuestionSuccess,
  registerQuestionUsage
} from '../nlq/questions.js';

function normalizeText(value) {
  if (typeof value !== 'string') return '';
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
          // Se quiser suportar consultas globais depois, adicione: scope: { type: 'string', enum: ['company', 'all'] }
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

      const tokenCompanyId = request.user?.companyId;
      const targetCompanyId =
        normalizeText(companyId) ||
        normalizeText(tokenCompanyId) ||
        fastify.config.defaultCompanyId;

      const normalizedSearchText = normalizeForSearch(normalizedText);
      const start = Date.now();

      let cypher, sql;
      let source = 'gemini';

      const approvalThreshold = Number.isFinite(fastify.config?.nlq?.approvalThreshold)
        ? fastify.config.nlq.approvalThreshold
        : DEFAULT_APPROVAL_THRESHOLD;

      // 1) Tenta catálogo aprovado
      try {
        const stored = await findApprovedQuestion({
          normalizedText: normalizedSearchText,
          companyId: targetCompanyId,
          threshold: approvalThreshold
        });

        if (stored) {
          cypher = stored.cypher;
          sql = stored.sql; // <- pega SQL salva
          source = 'catalog';

          await registerQuestionUsage({
            normalizedText: normalizedSearchText,
            companyId: stored.companyKey ?? targetCompanyId
          });
        }
      } catch (err) {
        fastify.log.error({ err }, 'Falha ao buscar pergunta aprovada no Neo4j');
      }

      // 2) Se não veio do catálogo, gera via Gemini ({ cypher, sql })
      if (!cypher || !sql) {
        try {
          const out = await generateQueries({
            text: normalizedText,
            companyId: targetCompanyId
          });
          cypher = out.cypher;
          sql = out.sql;
        } catch (err) {
          fastify.log.error({ err }, 'Erro ao gerar consultas via Gemini');
          reply.code(502);
          return {
            code: 'GEMINI_ERROR',
            message: 'Não foi possível gerar a consulta a partir do texto informado.'
          };
        }
      }

      // 3) Executa no Neo4j (Cypher)
      let graphRows = [];
      try {
        const result = await runCypher(cypher, { companyId: targetCompanyId });
        graphRows = result.records.map((record) => record.toObject());
      } catch (err) {
        fastify.log.error({ err, cypher }, 'Erro ao executar Cypher');
        reply.code(500);
        return {
          code: 'NEO4J_ERROR',
          message: 'Falha ao executar consulta no grafo.'
        };
      }

      // 4) Executa no Timescale (SQL)
      let sqlRows = [];
      let sqlError = null;
      try {
        const sqlParams = /\$1\b/.test(sql) ? [targetCompanyId] : [];
        const sqlResult = await runSql(sql, sqlParams);
        sqlRows = Array.isArray(sqlResult?.rows) ? sqlResult.rows : [];
      } catch (err) {
        fastify.log.error({ err, sql }, 'Erro ao executar SQL gerado');
        sqlError = {
          code: err.code,
          message: err.message
        };
      }

      // 5) Se veio do Gemini e SQL executou, salva no cat�logo (incluindo SQL)
      if (source === 'gemini' && !sqlError) {
        try {
          await registerQuestionSuccess({
            text: normalizedText,
            normalizedText: normalizedSearchText,
            companyId: targetCompanyId,
            cypher,
            sql // <- salva SQL
          });
        } catch (err) {
          fastify.log.error({ err }, 'Falha ao salvar pergunta NLQ no Neo4j');
        }
      }

      const total = Date.now() - start;
      const answerRows = sqlRows.length ? sqlRows : graphRows;

      fastify.log.info(
        {
          cypher,
          sql,
          totalMs: total,
          source,
          sqlRowCount: sqlRows.length,
          graphRowCount: graphRows.length,
          sqlError
        },
        'NLQ executado'
      );

      return {
        answer: buildAnswer(answerRows, targetCompanyId),
        cypher,
        sql, // <- devolve a SQL gerada/salva
        rows: sqlRows, // <- devolve resultado do SQL
        graphRows,
        source,
        totalMs: total,
        sqlError
      };
    }
  });
}

