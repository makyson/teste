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

## Autenticação

A API expõe autenticação via JWT. Para obter um token, faça uma requisição `POST /auth/login` com `username` e `password` definidos nas variáveis de ambiente `AUTH_USERNAME` e `AUTH_PASSWORD`. Opcionalmente informe `companyId` para vincular o token a uma empresa específica; caso contrário, será usada `DEFAULT_COMPANY_ID`.

Utilize o token recebido no cabeçalho `Authorization: Bearer <token>` para acessar rotas protegidas, como `POST /nlq/query`.
