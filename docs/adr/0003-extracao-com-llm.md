# ADR 0003: Extração com Groq, gpt-oss-20b e JSON Schema estrito

- **Status:** Aceita
- **Data:** 2026-11-27
- **Issue:** #5

## Contexto

A ADR 0001 escolheu o Groq no plano gratuito, atrás de uma interface trocável, com o LLM só extraindo dados da mensagem. Faltava escolher o modelo, garantir o formato da saída e decidir o que fazer quando o LLM falha ou bate no limite de uso.

## Decisão

| Tema | Decisão |
|------|---------|
| Interface | `LlmClient.completeJson` ([`llm-client.ts`](../../src/llm/llm-client.ts)): só sabe completar com JSON. O domínio fica no `MessageExtractor` |
| Modelo | `openai/gpt-oss-20b`: pesos abertos, em produção no Groq e com `json_schema` em modo `strict`. Trocável por `GROQ_MODEL` |
| Formato | `response_format: json_schema` com `strict: true`, gerado do schema Zod ([`extraction.schema.ts`](../../src/llm/extraction.schema.ts)). A resposta é validada de novo com Zod |
| Campos | Intenção, tamanho do botijão, maior/menor, quantidade, endereço, forma de pagamento, troco e nome. **Sem** preço, estoque, desconto, status ou ID de produto |
| Chamadas | Uma por mensagem. Só repete (uma vez) se a saída vier fora do schema |
| Falhas | Fora do schema duas vezes, provedor fora do ar, timeout ou sem chave: a conversa segue com botões |
| Limite (429) | Não repete. Respeita `retry-after` e, até lá, nem chama o Groq: vai direto para botões |
| Sem chave | `DisabledLlmClient`: a aplicação sobe e funciona só com botões |
| Injeção | Texto do cliente só na mensagem `user`, entre `<mensagem>` e `</mensagem>`, sem as tags e caracteres de controle, cortado em 1000 caracteres. O prompt de sistema manda tratar o bloco como dado. O schema não tem campo que dê poder ao texto |

## Alternativas consideradas

- **Llama 3.x no Groq:** bom em português, mas só aceita `json_object`, sem schema garantido.
- **Tool calling:** mesma garantia do `json_schema`, com mais formato de mensagem para manter.
- **Repetir após 429:** aumentaria o tempo do pedido e gastaria mais cota. Os botões resolvem o pedido sem o LLM.

## Consequências

- O texto do cliente vai para o Groq, um terceiro. Isso precisa constar na política de privacidade antes do uso real (LGPD).
- O gpt-oss gasta tokens de raciocínio. `max_completion_tokens` fica em 1024; se aparecer resposta cortada (`finish_reason: length`), ela conta como saída inválida.
- Os limites do plano gratuito mudam com o tempo. Conferir em <https://console.groq.com/docs/rate-limits>.
