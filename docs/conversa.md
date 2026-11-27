# Máquina de estados da conversa

- **Issue:** #6
- **Código:** [`src/conversation`](../src/conversation)

O código decide o próximo passo. O LLM só preenche campos ([ADR 0003](adr/0003-extracao-com-llm.md)); botões nem passam por ele.

## Etapas e transições

```mermaid
stateDiagram-v2
    [*] --> identifying
    identifying --> collecting: falta dado
    identifying --> confirming: recorrente ou já completo
    collecting --> confirming: completo
    confirming --> collecting: alterar, esgotou, pagamento recusado
    confirming --> sale_created: confirmou e a venda foi criada
    sale_created --> dispatched: revenda despachou
    identifying --> closed
    collecting --> closed
    confirming --> closed
    sale_created --> closed
    dispatched --> closed
    closed --> [*]
```

A tabela fica em [`transitions.ts`](../src/conversation/transitions.ts). Qualquer transição fora dela lança `IllegalTransitionError`, e o turno não é gravado.

| Etapa | Handler | O que faz |
|-------|---------|-----------|
| `identifying` | [`identifying.handler.ts`](../src/conversation/handlers/identifying.handler.ts) | Busca o cliente pelo telefone. Recorrente: último pedido num resumo só (confirma com um toque), sem reaproveitar produto esgotado nem pagamento desativado. Telefone fora do cadastro: cliente novo |
| `collecting` | [`collecting.handler.ts`](../src/conversation/handlers/collecting.handler.ts) | Aplica o que veio e pergunta o próximo campo: produto, endereço, pagamento, nome (só cliente novo) |
| `confirming` | [`confirming.handler.ts`](../src/conversation/handlers/confirming.handler.ts) | Resumo com Confirmar, Alterar e Cancelar; cria cliente (se novo) e venda |
| `sale_created` | [`after-sale.handlers.ts`](../src/conversation/handlers/after-sale.handlers.ts) | Cancelar pelo bot; o resto informa o status |
| `dispatched` | idem | Cancelar ou reclamar vai para o atendente |
| `closed` | idem | Final |

## Cliente novo (issue #8)

- **Uma mensagem com vários dados:** faltando dois ou mais campos, o bot pede todos juntos ("me diga numa mensagem só: botijão, endereço, pagamento, nome"), com os botões do primeiro campo de opções fechadas. Faltando um, pergunta só ele.
- **CPF:** na NFC-e o CPF do consumidor é opcional, então por padrão o bot não pede nem guarda. Com `CPF_REQUIRED=true`, pede só a cliente novo, valida os dígitos verificadores e mostra mascarado no resumo. Quem lê o CPF é o código: a resposta ao pedido de CPF não passa pelo LLM, e CPF no meio de outra mensagem vira `[cpf]` antes de ir ao Groq. No banco, a mensagem fica com o CPF mascarado, e ele sai do rascunho assim que o cadastro é criado.
- **Cadastro com confirmação:** o resumo mostra o nome e avisa que o cadastro e o endereço ficam salvos. O cliente só é criado na RevGás depois do Confirmar. Se a venda falhar logo depois, o ID já criado é mantido, para a nova tentativa não duplicar o cadastro.
- **Endereço novo de cliente antigo:** depois da venda, o bot pergunta se salva o endereço no cadastro (Salvar / Agora não). O `PUT` reenvia o cadastro atual inteiro, trocando só o endereço.

## Catálogo, preço e estoque (issue #9)

- **Catálogo:** produtos e formas de pagamento vêm da API, com cache de `CATALOG_CACHE_SECONDS` (padrão 120). Turnos simultâneos esperam a mesma carga.
- **Preço:** a API da RevGás não tem preço de produto. A revenda configura `PRODUCT_PRICES=P13:120,P20:180` (decimal com ponto). Sem tabela, o mock usa preços de demonstração e o modo real não vende nada, para o bot nunca inventar preço.
- **"Um maior" / "um menor":** o próximo tamanho à venda a partir do produto atual, pulando o que está sem estoque. Sem produto atual, ou "quero outro" sem dizer qual, mostra os produtos em botões.
- **Estoque:** a quantidade é conferida contra o estoque ao escolher. No Confirmar, o código consulta o estoque na API, sem cache, antes do cadastro e da venda.
- **Sem estoque:** oferece os outros produtos à venda e o atendente; nunca cria a venda. Se a RevGás recusar a venda por estoque, o cache é descartado e as opções são reabertas. Com mais de 3 opções, o canal mostra lista (WhatsApp, #18).

## Regras de qualquer etapa

- **Atendente:** pedir atendente encerra com passagem (handoff). Depois disso o bot só registra as mensagens, sem responder, até a sessão expirar.
- **Não entendeu:** repete a pergunta com botões; na segunda vez seguida, passa para o atendente.
- **RevGás fora do ar:** mantém etapa e rascunho e oferece atendente. Falha só no `POST /sales` mantém o resumo para tentar de novo.
- **LLM fora do ar ou no limite:** o turno segue como "não entendeu", com botões.

## Sessão

- Uma conversa ativa por contato (canal + telefone).
- **Expiração:** sem mensagem por `CONVERSATION_TTL_MINUTES` (padrão 30), a sessão é encerrada. Sem venda, conta como abandono; com venda, como concluída. Isso acontece na chegada da próxima mensagem e numa varredura a cada minuto.
- **Idempotência:** mensagem com `externalId` repetido não é processada de novo.
- **Ordem:** turnos do mesmo contato rodam um de cada vez.

## Provisório (fica para outras issues)

| Ponto | Hoje | Issue |
|-------|------|-------|
| Preço | `PRODUCT_PRICES` configurado pela revenda (a API não tem preço); recorrente paga o do último pedido. Sem tabela: demonstração no mock, nada à venda no modo real | pergunta 2 da #1 |
| Pagamento | Botões com todas as formas aceitas, menos fiado e vale gás | #10 |
| Endereço | Até 3 conhecidos (últimas vendas + cadastro) em botões, ou digitado; sem cobertura nem localização | #11 |
| Cancelamento | Usa o primeiro motivo cadastrado | #12 |
| Atendente | Sem resumo, sem horário de funcionamento, sem painel | #13 |
| Despacho | `ConversationService.notifyDispatched`, ainda sem quem chame | #13, #16 |
