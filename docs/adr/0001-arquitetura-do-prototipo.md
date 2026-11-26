# ADR 0001: Arquitetura do protótipo com custo zero

- **Status:** Proposta
- **Data:** 2026-11-26
- **Contexto do projeto:** Projeto de Extensão iCEV, cliente RevGás

## Contexto

A RevGás vende software de gestão para revendas de gás e fornece apenas a **API do ERP**. O desafio é reduzir o tempo de um pedido por WhatsApp, hoje de cerca de 5 minutos, ao menor valor possível. É um trabalho acadêmico, então todo o custo de infraestrutura, LLM e canal deve ser zero. Não há ambiente de teste confirmado para a API: criar uma venda pode gerar um pedido real.

## Objetivos

1. Reduzir o tempo do pedido e **mostrar isso com número**, comparando com os 5 minutos de hoje.
2. Cobrir cliente recorrente ("o mesmo de sempre") e cliente novo.
3. Entregar uma demonstração confiável para os donos da RevGás.
4. Manter custo zero e não expor chaves nem dados de clientes.

## Decisão

| Tema | Decisão |
|------|---------|
| Linguagem e framework | TypeScript com NestJS, código em vez de ferramenta visual (n8n) |
| Demo | Simulador de chat web, com cronômetro e histórico do tempo do pedido |
| Canal WhatsApp | Cloud API da Meta com número de teste, como adaptador opcional |
| LLM | Groq com modelo aberto, plano gratuito, atrás de uma interface trocável |
| API da RevGás | Mock fiel à documentação pública, atrás de uma interface, alternado por `REVGAS_USE_MOCK` |
| Fluxo | Máquina de estados em código; o LLM só extrai dados da mensagem (uma chamada por mensagem) |
| Dados | Postgres no Supabase gratuito: sessões e métricas |
| Execução | Local durante a demo; túnel gratuito só se o webhook da Meta for usado |
| Repositório | Público, sem segredos |

### Estrutura

```
src/
  conversation/   máquina de estados e handlers por etapa
  llm/            extração de dados e schema de validação
  revgas/         client real, client mock e tipos
  whatsapp/       webhook e client (adaptador opcional)
  metrics/        tempo do pedido
web/              simulador de chat e painel de tempo
```

### Medição

`first_message_at` é gravado na primeira mensagem e `sale_created_at` quando a venda é criada. O tempo do pedido é a diferença. Também registramos número de turnos e se houve passagem para atendente.

## Alternativas consideradas

- **n8n:** mais rápido de montar, mas menos controle sobre estado, testes e medição.
- **Rust:** ganho de milissegundos num fluxo que dura minutos; custo alto de aprendizado.
- **WhatsApp por Baileys ou Evolution API:** sem burocracia, mas não oficial e com risco de bloqueio do número.
- **Ollama local:** sem limite de uso, mas depende da máquina e é mais lento.
- **API real da RevGás completa:** só se a RevGás liberar ambiente de teste.

## Trade-offs

| Escolha | Ganho | Custo e mitigação |
|---------|-------|-------------------|
| Simulador na demo | Não depende da Meta nem de rede do celular | Menos impacto que WhatsApp real; o adaptador da Meta fica como evolução |
| Groq gratuito | Custo zero e resposta rápida | Limites de uso e qualidade variável em português; validar a saída com schema, fluxo determinístico, interface permite trocar de modelo |
| Mock da API | Nenhum risco de venda real | Pode divergir da API real; seguir a documentação e testar contra a real quando houver chave e ambiente de teste |
| Código em vez de n8n | Controle, testes e medição | Mais tempo de desenvolvimento |
| Local + Supabase gratuito | Sem deploy para quebrar na demo | Sem URL pública; projeto gratuito pode pausar por inatividade, então acordar antes da apresentação |
| Repositório público | Portfólio | Disciplina com segredos; `.env` ignorado e chave de exemplo vazia |

## Questões em aberto

- De onde vem o preço dos itens ao criar a venda?
- O que fazem exatamente "Avisar" e "Confirmar venda" na API?
- O caminho de criação de cliente (`POST /customers`) foi inferido e precisa de confirmação.
- A listagem de vendas filtra por cliente? Isso define como obter "o mesmo de sempre".
- Os 5 minutos de hoje são medidos do primeiro contato até o pedido lançado?
- A RevGás fornece ambiente de teste?

## Consequências

- Todo acesso à RevGás passa por uma interface; trocar mock por API real é configuração.
- O tempo do pedido vira métrica de primeira classe, visível na demo.
- A chave de API exposta anteriormente deve ser rotacionada com o suporte da RevGás antes de qualquer uso real.
