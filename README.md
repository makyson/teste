# Plataforma de Telemetria

Este repositório contém um script único que prepara um ambiente completo de ingestão, agregação e consulta de métricas elétricas usando Docker.

## Visão geral

Os serviços provisionados incluem:

- **API Node.js (Fastify)** para ingestão MQTT, rotas REST e endpoint NLQ com Gemini.
- **TimescaleDB (PostgreSQL 16)** para armazenamento bruto e agregados contínuos.
- **Neo4j 5.x** com APOC para grafo de entidades e métricas.
- **Mosquitto** para recebimento de telemetria via MQTT.
- **Redis** (opcional) disponível para uso futuro em cache/locks.

## Como usar

1. Garanta que Docker e Docker Compose v2 estejam instalados.
2. Execute o script `./setup.sh` na raiz do repositório.
3. Aguarde a criação dos arquivos, subida dos containers e aplicação dos schemas.
4. Opcionalmente, publique uma mensagem de exemplo com `./scripts/demo_publish.sh`.

O arquivo `.env` é gerado com valores padrão seguros para desenvolvimento. Ajuste conforme necessário antes de rodar em produção.

     codex/automatizar-geracao-de-sql
## Como funciona o NLQ (Natural Language Query)

1. A API recebe o texto da pergunta e o `companyId` desejado.
2. O serviço NLQ consulta primeiro o Neo4j em busca de uma pergunta semelhante já cadastrada com **aprovação ≥ 80%**.
3. Se existir uma correspondência aprovada, a API reutiliza o Cypher armazenado e executa diretamente no Neo4j.
4. Caso não haja correspondência suficiente, o serviço envia o prompt para o Gemini, que devolve **somente** uma consulta Cypher.
5. O Cypher gerado é sanitizado, executado no Neo4j e, em seguida, armazenado no grafo já com aprovação 100%, evitando novas validações manuais.
6. Cada execução atualiza métricas de uso da pergunta reaproveitada, mantendo um histórico de popularidade diretamente no grafo.
7. O resultado retornado ao cliente inclui o Cypher utilizado, a origem (`gemini` ou `catalog`) e as linhas provenientes do Neo4j.

> ℹ️ O pipeline continua exclusivo do grafo: não há geração nem execução automática de SQL no TimescaleDB/PostgreSQL. O Neo4j concentra tanto a execução quanto o histórico das consultas validadas.

## Autenticação

A API expõe autenticação via JWT. Para obter um token, faça uma requisição `POST /auth/login` com `username` e `password` definidos nas variáveis de ambiente `AUTH_USERNAME` e `AUTH_PASSWORD`. Opcionalmente informe `companyId` para vincular o token a uma empresa específica; caso contrário, será usada `DEFAULT_COMPANY_ID`.

Utilize o token recebido no cabeçalho `Authorization: Bearer <token>` para acessar rotas protegidas, como `POST /nlq/query`.
     main
