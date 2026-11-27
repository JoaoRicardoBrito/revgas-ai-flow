# API da RevGás: o que usamos

- **Fonte:** documentação pública em <https://revgas.stoplight.io/docs/revgas-api> (OpenAPI 3.1, consultada em 2026-11-27)
- **Código:** [`src/revgas`](../src/revgas)

Resumo só do que o protótipo usa. A especificação completa fica na fonte acima e não é copiada para cá.

## Infraestrutura

| Tema | Regra documentada | Como tratamos |
|------|-------------------|---------------|
| Servidores | Produção `https://api.revgas.com/v1`; homologação `https://apihomologacao.revgas.com/v1` marcada como **"Não utilizar"** | Só produção, e só com `REVGAS_USE_MOCK=false` |
| Autenticação | Chave crua no header `Authorization` (sem `Bearer`), pedida ao suporte | `HttpRevgasClient` envia em toda requisição |
| Limite | 1 requisição por segundo; acima disso, 429 | Fila com intervalo mínimo de 1 s; 429 é repetido até 2 vezes |
| Paginação | `page` e `page_size` (padrão 10, máximo 100); resposta `{ data, pagination }` | Listagens percorrem todas as páginas com `page_size=100` |
| Datas | Filtros `from`/`to` com no máximo 366 dias; sem filtro, mês atual | Última venda busca os últimos 365 dias |
| Erros | `{ message }`, e em 409/422 `{ data: [{ field, message }], message }` | Viram `RevgasError` com `code` e `fields` |

## Rotas usadas

| Método do client | Rota |
|------------------|------|
| `findCustomersByPhone` | `GET /customers?phone=` |
| `getCustomer` | `GET /customers/{id}` |
| `createCustomer` | `POST /customers` |
| `updateCustomerAddress` | `GET` + `PUT /customers/{id}` (o PUT reenvia o cadastro) |
| `listProducts` | `GET /products?establishment_id=&inactive=false` |
| `getProduct` | `GET /products/{id}` (traz `stock_quantity`) |
| `listPaymentTypes` | `GET /payment-types?establishment_id=&status=ACTIVE` |
| `findLastSale` | `GET /sales?customer_id=&from=&to=&page_size=1` |
| `getSale` | `GET /sales/{id}` |
| `createSale` | `POST /sales` com `channel: WHATSAPP`, `origin: INTEGRATION`, `option: NORMAL`, `broadcast: NEW_SALE` |
| `updateSale` | `PUT /sales/{id}` |
| `cancelSale` | `PUT /sales/{id}/cancel` com `motive_cancel_sale_id` |
| `listCancelMotives` | `GET /motive-cancel-sale?status=true` |

Existem e ainda não usamos: `PUT /sales/{id}/warning` (Avisar), `/confirm`, `/ignore` (entregador recusa) e `/cancelDelivery`.

## Achados que mudam o PRD

- **Preço:** produto não tem campo de preço. A venda recebe o `value` de cada item de quem chama. O preço precisa vir de outro lugar (pergunta 2 da #1, issue #9).
- **Endereço:** o cliente tem **um** endereço só (`location`, `number`, `neighborhood`...). O "Casa ou Trabalho" do PRD 6.4 não tem onde ser guardado na RevGás.
- **Pix:** `PIX` é só uma forma de pagamento registrada na venda. Não há geração de cobrança nem conciliação (pergunta 4).
- **Status da venda:** `OPEN`, `ACTIVE`, `WARNING`, `CONFIRM`, `CHECK`, `CANCEL`, sem a máquina de estados documentada. O filtro de listagem usa `WARN`, mas a resposta usa `WARNING` (inconsistência da documentação).
- **Cancelamento:** o estabelecimento tem `allow_cancel_sale` ("permitir cancelamento de vendas fora do prazo"), o que indica um prazo que não está documentado.
- **Campos obrigatórios:** a especificação não marca nenhum. O fake supõe `name` no cliente e `products` na venda.

## O que o fake supõe

Comportamentos não documentados, marcados com `SUPOSIÇÃO` em [`fake-revgas-api.ts`](../src/revgas/fake/fake-revgas-api.ts):

- Venda sem estoque é recusada com 422 (configurável: `rejectSaleWithoutStock`).
- Venda baixa o estoque na criação; cancelamento devolve.
- Venda só é alterada em `OPEN`, `ACTIVE` ou `WARNING`; não cancela em `CHECK` ou `CANCEL`.
- Pagamento recusado (422 em `payments`) **não existe na API**; só no fake, para o caminho do PRD 6.8.

## Testes

- `npm test` roda o contrato inteiro contra o fake.
- `npm run test:contract:real` roda só a parte de **leitura** contra produção. Precisa de `REVGAS_API_KEY` e `REVGAS_ESTABLISHMENT_ID` no `.env`. Nunca cria nem altera nada.
