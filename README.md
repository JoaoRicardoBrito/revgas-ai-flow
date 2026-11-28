# RevGás AI Flow

Protótipo de um atendente com IA que recebe pedidos de gás por chat e cria a venda no sistema RevGás. Projeto de Extensão do iCEV (Engenharia de Software, 2026.2).

## Desafio

Hoje um pedido leva cerca de **5 minutos**. O objetivo é reduzir esse tempo ao máximo. O **tempo do pedido** é medido do primeiro "oi" até a venda criada.

## Escopo do protótipo

- Cliente recorrente: reconhecido pelo telefone, recebe "o mesmo de sempre" em poucos toques.
- Cliente novo: cadastro e pedido na mesma conversa.
- Demonstração em simulador de chat web, com cronômetro e histórico do tempo de cada pedido.
- Canal WhatsApp (Cloud API da Meta, número de teste) como adaptador opcional.

## Decisões

O que queremos resolver está no [PRD](docs/PRD.md). O fluxo da conversa está em [docs/conversa.md](docs/conversa.md). As decisões de arquitetura ficam em [`docs/adr`](docs/adr). Comece pela [ADR 0001](docs/adr/0001-arquitetura-do-prototipo.md).

## Stack

TypeScript, NestJS, Postgres (Supabase gratuito), Groq (modelo aberto), simulador web em React. API da RevGás simulada por um mock fiel à documentação pública.

## Como rodar

Requer Node 22.12 ou superior (o CI usa a versão do `.nvmrc`).

```bash
npm install
cp .env.example .env   # opcional: sem .env, sobe em modo mock com valores padrão
npm run start:dev      # http://localhost:3000/health
```

Com `REVGAS_USE_MOCK=true` (padrão) nada é enviado à API real da RevGás. Sem `DATABASE_URL`, o banco é um PGlite em memória, já migrado; com ela, rode `npm run db:migrate` antes da primeira subida. A configuração é validada na subida; se faltar ou sobrar algo, a aplicação não sobe e lista as variáveis com problema, sem mostrar os valores.

### Simulador de chat

```bash
npm run demo   # compila e sobe; abra http://localhost:3000/chat/
```

A tela usa o mesmo núcleo de conversa do canal WhatsApp. Escolha o cliente simulado (recorrente, sem pedidos ou novo). Sem `GROQ_API_KEY`, só os botões são entendidos; para escrever livremente, use uma chave do plano gratuito da Groq. O simulador só responde em modo mock e na própria máquina.

Ao lado do chat, o painel de tempo mostra o cronômetro do pedido, a comparação com os 5 minutos de hoje e o histórico com o tempo por etapa (LLM, RevGás e o restante, que é principalmente o cliente respondendo).

Para mexer na tela com recarga automática, rode `npm run start:dev` e, em outro terminal, `npm run web:dev` (http://localhost:5173/chat/).

| Comando | O que faz |
|---------|-----------|
| `npm run check` | Formatação, lint, tipos, testes e e2e, na mesma ordem do CI |
| `npm test` / `npm run test:e2e` | Testes de unidade (`src/**/*.spec.ts`) e e2e (`test/**/*.e2e-spec.ts`) |
| `npm run lint` | oxlint com regras que usam tipos |
| `npm run format` | Prettier |
| `npm run build` | Compila a API para `dist/` e a tela para `web/dist/` |
| `npm run db:generate` | Gera a migration SQL a partir de `src/database/schema.ts` |
| `npm run db:migrate` | Aplica as migrations no `DATABASE_URL` (Supabase) |
| `npm run db:check` | Falha se o schema mudou sem migration (roda no CI) |
| `npm run test:llm:live` | Extração contra o Groq real (gasta cota; precisa de `GROQ_API_KEY`) |
| `npm run test:contract:real` | Contrato de leitura contra a API real da RevGás |

## Segurança

Este repositório é público. Não versione chaves, tokens, dados de clientes nem documentação interna da RevGás.
