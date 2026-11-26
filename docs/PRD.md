# PRD: RevGás AI Flow

- **Status:** Rascunho
- **Data:** 2026-11-26
- **Relacionado:** [ADR 0001](adr/0001-arquitetura-do-prototipo.md)

## 1. Problema

O cliente pede gás pelo WhatsApp. Hoje um atendente conduz o pedido, que leva cerca de **5 minutos**, e depois a revenda chama um motoboy para entregar. Esse tempo é trabalho humano repetido: pedir nome, endereço e produto de novo, mesmo para quem já comprou várias vezes. Enquanto o atendente está ocupado, outros clientes esperam ou desistem.

## 2. Objetivo

Um atendente com IA que conduz o pedido até a venda criada no sistema da RevGás, no **menor tempo possível**, sem tirar do cliente o direito de falar com uma pessoa.

### Métricas de sucesso

| Métrica | Definição | Referência |
|---------|-----------|------------|
| Tempo do pedido | Primeira mensagem até a venda criada | Hoje: 5 min |
| Pedidos sem humano | Vendas criadas sem passagem para atendente | A medir no piloto |
| Taxa de conclusão | Conversas que viram venda | A medir no piloto |
| Erros de pedido | Pedidos cancelados ou corrigidos por erro do bot | Quanto menor, melhor |

Não definimos metas numéricas antes de medir a situação atual da revenda piloto.

## 3. Fora do escopo (protótipo)

- Cobrança online de cartão e processamento de pagamento real.
- Pix dinâmico com confirmação automática (exige provedor de pagamento).
- Mais de uma revenda e roteamento por região.
- Voz, imagem e outros produtos além de gás (água, por exemplo).

## 4. Usuários

- **Cliente:** pede gás pelo chat. Pode ser recorrente ou novo.
- **Atendente da revenda:** assume conversas que o bot não resolve.
- **Entregador (motoboy):** recebe o pedido e entrega. Não fala com o bot.
- **Dono da revenda:** acompanha tempo e volume.

## 5. Fluxo principal

1. Cliente chama. O bot identifica pelo telefone.
2. **Recorrente:** "Mesmo pedido de sempre? 1 botijão P13, Rua X, Pix." Dois toques e confirma.
3. **Novo:** o bot pede o que falta (nome, endereço, produto, pagamento), tudo na mesma conversa.
4. O bot mostra um resumo e o cliente confirma.
5. O código cria a venda no ERP e avisa o cliente. A revenda chama o entregador.

Regra geral: **o LLM só extrai dados do texto do cliente. Quem decide preço, estoque, estado do pedido e cobrança é o código, com dados da API.**

## 6. Requisitos por cenário

### 6.1 Cancelar no meio do pedido

O que é possível depende do estado do pedido.

| Estado | Cancelar | Alterar produto | Alterar endereço |
|--------|----------|-----------------|------------------|
| Coletando ou confirmando (sem venda) | Livre, a conversa só encerra | Livre | Livre |
| Venda criada, aguardando despacho | Pelo bot | Pelo bot (alterar a venda ou cancelar e recriar) | Pelo bot, com revalidação |
| Despachado, entregador a caminho | Só com atendente | Não | Só com atendente e entregador |
| Entregue | Não cancela; reclamação vai ao atendente | Não | Não |

- Cancelamento depois do despacho vai para o atendente, que combina com o entregador. Pode haver taxa, regra definida pela revenda.
- O pedido cancelado fica registrado com o motivo, para a métrica de erros.
- **Pendência:** confirmar com a RevGás se a API permite cancelar e alterar venda, e a partir de qual estado.

### 6.2 Forma de pagamento

- O bot mostra **só as formas cadastradas na revenda**, lidas da API, sem lista fixa no código.
- Apresentação em botões (até 3 por vez no WhatsApp) ou lista (para mais opções). Cliente recorrente já vê a última forma usada.
- Formas previstas: dinheiro, cartão na entrega (maquininha), Pix e, para clientes autorizados pela revenda, fiado ou vale gás.
- **Não oferecemos cartão online.** Cobrança online exige provedor de pagamento, custo e conformidade, fora do escopo.

### 6.3 Como o Pix é gerado

Três níveis, em ordem de maturidade:

1. **Pix na entrega:** o cliente paga ao entregador. É o padrão do protótipo e não exige integração.
2. **Pix copia e cola estático:** o bot envia o código da chave da revenda e o valor. A confirmação é manual (entregador ou atendente), porque não há retorno automático.
3. **Pix dinâmico com provedor:** gera cobrança única e confirma sozinho por retorno do provedor. Fora do escopo por custo e burocracia.

No protótipo, o código Pix é **fictício**, marcado como demonstração, e nenhum dinheiro é movimentado.

**Pendência:** descobrir se a API ou a plataforma da RevGás já gera Pix ou concilia pagamentos. Se gerar, usamos o deles.

### 6.4 Repetir dados

O cliente **não repete nada** que já está cadastrado.

- Nome, endereços e último pedido vêm do cadastro, buscado pelo telefone.
- O bot confirma em uma linha e só pergunta o que mudou.
- **CPF só é pedido se a nota fiscal exigir.** Menos dado, menos risco (LGPD).
- Cliente com mais de um endereço escolhe por botão ("Casa" ou "Trabalho").
- O telefone do WhatsApp só identifica o cliente se for o cadastrado; se o número for outro, o bot trata como cliente novo e pode vincular depois.

### 6.5 Mudar o produto

- "Quero um maior" ou "um menor" mapeia para os produtos disponíveis na revenda (por exemplo P13 e P20), lidos da API.
- Se a frase for ambígua ("outro"), o bot mostra as opções em botões.
- Mudança **antes da confirmação** é livre. Depois da venda criada segue a tabela do item 6.1.
- O preço é sempre o da API e o bot mostra o valor antes de confirmar. Troca de produto recalcula o total.

### 6.6 Mudar o endereço

- O cliente pode digitar o endereço, escolher um salvo ou enviar a **localização** do WhatsApp.
- O código valida se o endereço está na **área de cobertura** da revenda. Fora dela, o bot avisa e oferece o atendente.
- Se o endereço mudar depois do despacho, vai para o atendente.
- Endereço novo é salvo no cadastro para os próximos pedidos, com confirmação do cliente.

### 6.5.1 Falar com uma pessoa

Sim, sempre. Nem tudo é IA.

- O cliente pode pedir atendente a qualquer momento ("atendente", "falar com uma pessoa"), e o bot **para de insistir**.
- Passagem automática quando: o bot não entende após duas tentativas, há reclamação, o pagamento tem problema, o cancelamento é após despacho, ou o cliente demonstra irritação.
- A passagem leva o **resumo da conversa e o que já foi coletado**, para o cliente não repetir.
- Fora do horário da revenda, o bot informa o horário e registra o pedido de atendimento.
- No protótipo, uma tela simula o painel do atendente.

### 6.7 Produto sem estoque

- Quem decide é o **código**, consultando o estoque pela API antes de confirmar. O LLM não sabe nem inventa estoque.
- Sem estoque: o bot avisa, oferece outro produto disponível ou o atendente. Nunca cria venda para item indisponível.
- Estoque pode mudar entre a consulta e a criação da venda. Se a criação falhar por isso, o bot explica e reabre as opções.
- **Pendência:** confirmar se a API expõe estoque por produto em tempo real e se a venda é recusada sem estoque.

### 6.8 Pagamento recusado

Só se aplica a formas com cobrança antes da entrega (Pix dinâmico ou cartão online, fora do protótipo). Regras previstas:

- O bot informa o motivo em linguagem simples e oferece **outra forma de pagamento** ou pagar na entrega.
- A venda de pagamento antecipado **só é despachada depois da confirmação**.
- Após duas falhas, passa para o atendente.
- No protótipo, simulamos uma recusa no mock para testar esse caminho.

### 6.9 Só cartão?

Não. As formas são as da revenda: dinheiro, cartão na entrega, Pix, e fiado ou vale gás para quem tem. Ver 6.2.

## 7. Outras lacunas tratadas

| Lacuna | Regra |
|--------|-------|
| Pedido duplicado | Cada mensagem tem ID guardado; reenvio do webhook não cria segunda venda. Pedido idêntico em poucos minutos pede confirmação |
| Cliente some no meio | Sessão expira após tempo parado; conta como abandono, sem venda |
| Cliente manda áudio, foto ou figurinha | O bot pede texto ou oferece botões; áudio fica fora do protótipo |
| Cliente pede algo fora de gás | Responde que só atende pedidos de gás e oferece atendente |
| Fora do horário | Informa horário e registra o pedido para quando abrir, se a revenda quiser |
| LLM fora do ar ou limite do Groq | Cai para menu de botões, sem texto livre, e o pedido continua |
| Texto malicioso (injeção de prompt) | O texto do cliente é dado, não instrução. O LLM não decide preço, estoque, reembolso nem acesso a dados |
| Cliente com pendência (fiado atrasado) | Regra da revenda; o bot não bloqueia sozinho, encaminha ao atendente |
| Quantidade absurda | Limite por pedido definido pela revenda; acima disso, atendente |
| Entregador não acha o cliente | Fora do bot; atendente liga ao cliente |
| Dados pessoais | Guardar o mínimo, não colocar CPF e endereço em log, política clara de retenção |
| Falha da API da RevGás | O bot avisa, não perde a conversa e tenta de novo ou passa ao atendente |

## 8. Escopo do protótipo

**Dentro:** recorrente e novo, resumo e confirmação, alterar produto e endereço antes da venda, cancelar antes do despacho, passagem para atendente simulada, estoque e pagamento recusado simulados no mock, cronômetro e histórico do tempo do pedido.

**Depois:** Pix dinâmico, cancelamento e alteração após o despacho integrados, canal WhatsApp real em produção, várias revendas.

## 9. Riscos

| Risco | Mitigação |
|-------|-----------|
| A API não permite cancelar ou alterar venda | Cancelar e recriar; se não der, atendente |
| Mock diverge da API real | Seguir a documentação e testar com a real quando houver chave e ambiente |
| Groq gratuito com limite e qualidade variável | Fluxo em máquina de estados, saída validada por schema, fallback em botões |
| Venda real criada por engano nos testes | `REVGAS_USE_MOCK=true` por padrão e ambiente de teste da RevGás |
| Vazamento de chave em repositório público | `.env` ignorado, chave rotacionada, revisão antes de cada push |

## 10. Perguntas para a RevGás

1. A API permite cancelar e alterar uma venda? Em que estados?
2. De onde vem o preço dos itens ao criar a venda?
3. O que fazem "Avisar" e "Confirmar venda"?
4. A API ou a plataforma gera Pix ou concilia pagamento?
5. O estoque por produto está disponível em tempo real?
6. Há área de cobertura, taxa de entrega ou limite por pedido cadastrados?
7. Como a revenda quer tratar cancelamento depois do despacho, com taxa ou não?
8. Existe ambiente de teste?
9. Os 5 minutos de hoje contam de qual instante até qual?
