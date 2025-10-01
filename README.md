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
4. Opcionalmente, publique uma mensagem de exemplo com `./scripts/demo_publish.sh` ou utilize o script `./scripts/month_fill.ps1` para enviar um mês de amostras sintéticas via HTTP.

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

## Ingestão HTTP de telemetria

Além da ingestão via MQTT, a API expõe o endpoint autenticado `POST /companies/{companyId}/boards/{boardId}/telemetry`. Ele aceita um objeto único ou um array de objetos com os campos `logical_id`, `ts` e métricas opcionais (`voltage`, `current`, `frequency`, `power_factor`).

O script `scripts/month_fill.ps1` demonstra como autenticar, gerar e enviar amostras sequenciais para este endpoint usando PowerShell.
     main


## Regras inteligentes automatizadas

O serviço agora permite persistir, gerar e executar regras em cima do NLQ: relatórios agendados e alertas contínuos. A tabela `nlq_rules` fica no TimescaleDB (veja `sql/02_nlq_rules.sql`).

### Como funciona

1. A cada criação/edição de regra (`POST /rules`, `PATCH /rules/:id`) o texto enviado é passado pelo Gemini para gerar Cypher e SQL.
2. O SQL é validado, salvo junto com a regra e pode ser executado tanto sob demanda quanto de forma automática.
3. Um gerenciador em memória (node-cron) ativa jobs agendados (`schedule_report`) e monitora regras de alerta (`threshold_alert`).
4. Resultados (ou alertas) são persistidos (`last_run_at`, `last_result`) e enviados em tempo real por WebSocket.

### Endpoints REST

- `GET /rules` – lista regras da empresa do token (filtro opcional por status).
- `GET /rules/:id` – consulta detalhes da regra.
- `POST /rules` – cria uma regra (campos: `name`, `type`, `prompt`, `scheduleCron`, `metadata`, `activate`).
- `PATCH /rules/:id` – altera descrição, cron, prompt (regenera queries) ou metadados.
- `POST /rules/:id/activate` / `POST /rules/:id/deactivate` – liga/desliga execução automática.
- `DELETE /rules/:id` – remove a regra.

Todas as rotas exigem JWT e respeitam o `companyId` do token.

### Notificações WebSocket

- Conecte em `ws://<host>:3000/ws?token=<JWT>` (o token é o mesmo das rotas REST).
- O servidor entrega mensagens JSON com `type` (`rule.report` ou `rule.alert`), `ruleId`, `rows` e metadados.
- As conexões são segregadas por empresa: cada socket só recebe eventos da própria companhia.

### Execução das regras

- **Relatório agendado (`schedule_report`)**: descreva em linguagem natural (ex.: `todo dia às 8h`, `em 20/09/2025 às 10h`). A IA converte para cron e registra no catálogo.
- **Alerta contínuo (`threshold_alert`)**: cadastre a condição no prompt/metadata. O motor executa as regras ativas a cada minuto; se o SQL retornar linhas, um evento `rule.alert` é disparado.
- Use `metadata` para guardar configurações extras (ex.: lista de devices, cooldown customizado).

### Atualização de schema

Se já possui o ambiente rodando, aplique `sql/02_nlq_rules.sql` no banco Timescale ou rode o `setup.sh` novamente para provisionar a tabela `nlq_rules`.

## WebSocket e jobs adicionais

- Dependências novas: `@fastify/websocket` (canal em tempo real) e `node-cron` (agendamentos).
- As mensagens em tempo real são úteis para dashboards/centros de operações consumirem relatórios (8h) ou alertas de tensão > 50 mV por 5 minutos, por exemplo.
- O gerenciador de regras para automaticamente durante o shutdown (`SIGINT`/`SIGTERM`).


### UI rápida

Uma UI simples está disponível em `/app/rules.html`. Abra no navegador, informe um token JWT e manipule as regras (criar, ativar, remover) sem precisar de ferramentas externas.
