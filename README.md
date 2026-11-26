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

As decisões de arquitetura ficam em [`docs/adr`](docs/adr). Comece pela [ADR 0001](docs/adr/0001-arquitetura-do-prototipo.md).

## Stack

TypeScript, NestJS, Postgres (Supabase gratuito), Groq (modelo aberto), simulador web em React. API da RevGás simulada por um mock fiel à documentação pública.

## Como rodar

Em construção. Copie `.env.example` para `.env` e preencha os valores. Com `REVGAS_USE_MOCK=true` nada é enviado à API real da RevGás.

## Segurança

Este repositório é público. Não versione chaves, tokens, dados de clientes nem documentação interna da RevGás.
