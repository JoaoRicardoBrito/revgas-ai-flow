# Perguntas para a RevGás

- **Status:** Aguardando envio
- **Data:** 2026-11-27
- **Issue:** #1
- **Origem:** [PRD, seção 10](PRD.md#10-perguntas-para-a-revgás) e [ADR 0001, questões em aberto](adr/0001-arquitetura-do-prototipo.md#questões-em-aberto)

Cada pergunta tem a suposição que usamos **até a resposta chegar**, para o desenvolvimento não parar. Toda suposição fica isolada no mock (`REVGAS_USE_MOCK=true`) ou em configuração, então trocar depois é barato.

> Este repositório é público. As respostas da RevGás que forem documentação interna (rotas não públicas, regras comerciais, dados de clientes) **não entram aqui**. Registre só a decisão que tomamos a partir delas.

## Perguntas, impacto e suposição provisória

| # | Pergunta | Por que importa | Suposição até a resposta | Issues afetadas |
|---|----------|-----------------|--------------------------|-----------------|
| 1 | A API permite cancelar e alterar uma venda? Em que estados? | Define se o bot cancela ou altera sozinho depois da venda criada (PRD 6.1) | Cancelar só em "aguardando despacho". Alterar = cancelar e recriar | #3, #11, #12 |
| 2 | De onde vem o preço dos itens ao criar a venda? Enviamos o preço ou a API calcula pelo produto? | O preço é sempre do sistema, nunca do LLM (PRD 6.5) | A API devolve o preço no catálogo e calcula o total; nós só enviamos produto e quantidade | #3, #9 |
| 3 | O que fazem "Avisar" e "Confirmar venda"? São obrigatórios após criar a venda? | Define quando consideramos a venda "criada" para medir o tempo | Criar a venda basta. "Confirmar" e "Avisar" ficam como passos opcionais no mock | #3, #6, #15 |
| 4 | A API ou a plataforma gera Pix ou concilia pagamento? | Se gerar, usamos o deles e evitamos provedor (PRD 6.3) | Pix na entrega; código Pix fictício na demo | #10 |
| 5 | O estoque por produto está disponível em tempo real? A venda é recusada sem estoque? | O código checa estoque antes de confirmar (PRD 6.7) | Consulta de estoque por produto existe; a criação pode falhar por falta de estoque | #3, #9 |
| 6 | Há área de cobertura, taxa de entrega ou limite por pedido cadastrados no sistema? | Validação de endereço e de quantidade (PRD 6.6 e seção 7) | Sem taxa. Cobertura por lista de bairros em configuração. Limite de 5 unidades por pedido | #9, #11 |
| 7 | Como a revenda quer tratar cancelamento depois do despacho? Com taxa ou não? | Regra de negócio que o bot não pode inventar | Sempre passa para o atendente; o bot não fala em taxa | #12, #13 |
| 8 | Existe ambiente de teste (sandbox) ou uma revenda de teste? | Sem isso, criar venda na API real gera pedido real | Só mock. Nenhuma chamada à API real | #3, #19, #20 |
| 9 | Os 5 minutos de hoje contam de qual instante até qual? Há registro para medir? | É a linha de base da métrica principal | Do primeiro "oi" do cliente até a venda lançada no sistema | #15, #17, #20 |
| 10 | Podem gerar uma chave de API nova e revogar a anterior? | A chave anterior foi exposta | Nenhuma chamada real até termos a chave nova | #19 |
| 11 | Existe rota para criar cliente? `POST /customers` está correto? | O caminho foi inferido, não está na documentação | Rota `POST /customers` com nome, telefone e endereço | #3, #8 |
| 12 | A listagem de vendas filtra por cliente (ou telefone)? | É assim que obtemos "o mesmo de sempre" | Filtro por cliente existe; usamos a venda mais recente | #3, #7 |
| 13 | Como a revenda indica quem pode comprar fiado ou com vale gás? | Essas formas só aparecem para clientes autorizados (PRD 6.2) | Fiado: `credit_limit` maior que zero. Vale gás: categoria do cliente com "vale gás" no nome | #10 |
| 14 | Como saber se a venda foi despachada ou entregue? | O bot só cancela antes do despacho (PRD 6.1) e precisa do estado real | Despachada: entregador atribuído (`deliverer_id`) ou status `WARNING`. Entregue: `delivered_at` preenchido | #12 |

As perguntas 11 e 12 vêm da ADR 0001 e ainda não estão na lista da issue #1.

## Mensagem para enviar

Texto pronto para e-mail ou WhatsApp. Ajuste a saudação e a assinatura.

---

Olá, equipe RevGás!

Somos o time do projeto de extensão do iCEV que está construindo o atendente com IA para pedidos de gás. Para o protótipo funcionar igual ao sistema de vocês, temos algumas dúvidas sobre a API e sobre a operação da revenda. Se for mais fácil, podemos marcar uma chamada de 20 minutos.

**Sobre a API**

1. É possível cancelar ou alterar uma venda pela API? A partir de qual estado isso deixa de ser permitido (por exemplo, depois do despacho)?
2. Na criação da venda, nós enviamos o preço de cada item ou a API calcula pelo produto cadastrado?
3. O que fazem "Avisar" e "Confirmar venda"? Precisamos chamar algum deles depois de criar a venda?
4. A API ou a plataforma gera cobrança Pix ou concilia pagamentos?
5. O estoque de cada produto pode ser consultado em tempo real? A venda é recusada quando não há estoque?
6. Para cadastrar um cliente novo, a rota é `POST /customers`? Quais campos são obrigatórios?
7. A listagem de vendas pode ser filtrada por cliente ou telefone? Queremos sugerir o último pedido para quem já comprou.
8. Existe ambiente de teste ou uma revenda de teste? Queremos evitar criar pedidos reais durante o desenvolvimento.

**Sobre a operação da revenda**

9. Área de cobertura, taxa de entrega e limite de quantidade por pedido ficam cadastrados no sistema? Se não, quais são as regras?
10. Quando o cliente cancela depois que o entregador já saiu, existe taxa? Como vocês tratam hoje?
11. Os cerca de 5 minutos de um pedido hoje são contados a partir de quando e até quando? Se puderem registrar os horários de alguns pedidos reais (início da conversa e pedido lançado), usamos isso como comparação.

**Sobre acesso**

12. A chave de API que recebemos acabou exposta. Podem revogá-la e gerar uma nova? Até lá, não fazemos nenhuma chamada ao sistema real.

**Sobre pagamento**

13. Como vocês indicam quais clientes podem comprar fiado ou com vale gás? Usamos o limite de crédito do cadastro para fiado e a categoria do cliente para vale gás. Está certo?

**Sobre o estado da venda**

14. Como identificamos que uma venda já foi despachada ou entregue? Hoje consideramos despachada quando há entregador atribuído (`deliverer_id`) ou o status é `WARNING` (Avisar), e entregue quando `delivered_at` vem preenchido. Está certo? Também: qual o prazo para cancelar (`allow_cancel_sale`)?

Obrigado!
Equipe RevGás AI Flow, iCEV

---

## Respostas

Preencher conforme chegarem. Registrar só a decisão, não a documentação interna.

Respostas parciais vieram da [documentação pública](revgas-api.md) em 2026-11-27. As perguntas continuam valendo onde a documentação é omissa.

| # | Resposta (resumo) | Data | Decisão / mudança no PRD ou ADR |
|---|-------------------|------|----------------------------------|
| 1 | Parcial (docs): existem `PUT /sales/{id}` e `PUT /sales/{id}/cancel` com motivo. Estados permitidos não documentados; há um prazo de cancelamento (`allow_cancel_sale`) | 2026-11-27 | Fake permite alterar em OPEN/ACTIVE/WARNING e cancelar fora de CHECK/CANCEL. **Perguntar o prazo** |
| 2 | Parcial (docs): produto não tem preço; a venda recebe `value` por item | 2026-11-27 | **Perguntar** de onde a revenda tira o preço. Afeta a #9 |
| 3 | Parcial (docs): "Avisar" = `PUT /sales/{id}/warning` (status WARNING), "Confirmar" = `/confirm` (CONFIRM). O efeito não está descrito | 2026-11-27 | Não chamamos nenhum dos dois; a venda conta como criada no `POST` |
| 4 | Parcial (docs): não há geração de Pix nem conciliação; `PIX` é só forma de pagamento | 2026-11-27 | Mantém Pix na entrega / fictício |
| 5 | Parcial (docs): `stock_quantity` por produto. Recusa sem estoque não documentada | 2026-11-27 | Fake recusa com 422; configurável |
| 6 | | | |
| 7 | | | |
| 8 | Parcial (docs): existe homologação, mas marcada como "Não utilizar" | 2026-11-27 | **Perguntar** se podemos usar; até lá, só mock |
| 9 | | | |
| 10 | | | |
| 11 | Sim (docs): `POST /customers`; nenhum campo marcado como obrigatório | 2026-11-27 | Enviamos `name`, `type: PHYSICAL`, `phones` e endereço |
| 12 | Sim (docs): `GET /sales?customer_id=`, mais recente primeiro, janela máxima de 366 dias | 2026-11-27 | `findLastSale` usa os últimos 365 dias |
| 13 | | | |
| 14 | | | |
