# ADR 0002: Drizzle com migrations em SQL e PGlite nos testes

- **Status:** Aceita
- **Data:** 2026-11-27
- **Issue:** #4

## Contexto

A ADR 0001 definiu Postgres no Supabase gratuito para sessões e métricas. Faltava escolher como acessar o banco, versionar o schema e testar sem depender de um Supabase no ar, nem no CI nem na máquina de quem desenvolve.

## Decisão

| Tema | Decisão |
|------|---------|
| Acesso | Drizzle ORM: schema em TypeScript ([`src/database/schema.ts`](../../src/database/schema.ts)), queries tipadas, sem binário nem gerador de client |
| Migrations | SQL gerado pelo `drizzle-kit` em [`drizzle/`](../../drizzle) e versionado. `npm run db:generate` cria, `npm run db:migrate` aplica no `DATABASE_URL` |
| Produção | Driver `pg` contra o Supabase. A aplicação **não** migra o banco real sozinha na subida |
| Testes e dev | PGlite (Postgres em WASM, no processo), com as mesmas migrations. Sem `DATABASE_URL`, a aplicação sobe com ele em memória |
| CI | `npm run db:check` falha se o schema mudou sem migration |
| Segurança | RLS ligado nas três tabelas, sem policies: a Data API do Supabase (chave anônima) não lê nem grava nada. O backend conecta como dono das tabelas |
| Dados pessoais | Telefone, endereço e texto ficam só no banco. Logger do Drizzle desligado; `toLogSafe` antes de logar qualquer objeto |

## Modelo

- `conversations`: uma por contato **enquanto ativa** (índice único parcial). Guarda a etapa da máquina de estados e os dados coletados.
- `messages`: entrada e saída. `external_id` (wamid) é único: o reenvio do webhook não grava duas vezes nem conta turno de novo.
- `order_metrics`: uma por conversa. `first_message_at`, `sale_created_at` (só a primeira venda conta), turnos, passagem para atendente, resultado e tempo gasto em LLM e RevGás. Restrições no banco: venda não antes da primeira mensagem, turnos e tempos não negativos, `handed_off` coerente com `handed_off_at`.

## Alternativas consideradas

- **Prisma:** maduro, mas traz engine binária e client gerado; mais peso do que o protótipo precisa.
- **SQL puro com `pg`:** controle total, mas sem tipos nas queries e com migrator caseiro.
- **Postgres em Docker nos testes:** mais fiel ao Supabase, mas exige Docker no CI e em cada máquina. O PGlite é Postgres de verdade (não um emulador) e cobre o que usamos.

## Consequências

- Os testes de banco rodam em milissegundos, sem serviço externo.
- Recursos específicos do Supabase (extensões, `auth`) não são exercitados pelo PGlite. Se passarmos a usá-los, os testes precisam de um Postgres real.
- Retenção: ainda não há rotina para apagar conversas antigas. Fica para quando houver uso real (LGPD).
