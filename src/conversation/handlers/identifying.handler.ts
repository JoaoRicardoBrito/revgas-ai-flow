import { authorizedPaymentsFor, sellable } from '../catalog.js';
import type { Draft } from '../conversation.types.js';
import { applySignal, distinctAddresses, paymentOptions } from '../draft.js';
import {
  advance,
  loadOffer,
  outsideCoverage,
  type StepHandler,
} from './handler.js';
import type { Offer } from '../catalog.js';
import { isCovered, NO_COVERAGE_RULES } from '../coverage.js';
import type { Address } from '../../revgas/revgas.types.js';

/** Vendas olhadas para montar os endereços conhecidos. */
const RECENT_SALES = 5;

/**
 * Primeira mensagem. Busca o cliente pelo telefone (issue #7):
 *
 * - Recorrente: pré-preenche o último pedido e mostra o resumo numa
 *   mensagem só, para confirmar com um toque. Produto esgotado ou forma de
 *   pagamento desativada não são reaproveitados: viram pergunta.
 * - Telefone que não está no cadastro: cliente novo, mesmo que a pessoa já
 *   tenha comprado com outro número.
 *
 * Depois aplica o que a própria mensagem trouxe e segue para o que falta.
 */
export const identifyingHandler: StepHandler = async (state, signal, ctx) => {
  const [customer] = await ctx.revgas.findCustomersByPhone(ctx.contact);
  const recent = customer
    ? await ctx.revgas.listRecentSales(customer.id, RECENT_SALES)
    : [];
  const offer = await loadOffer(ctx);

  const savedAddresses = distinctAddresses([
    ...recent.map((s) => s.address),
    customer?.address,
  ]);
  let draft: Draft = {
    ...state.draft,
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          savedAddresses,
          cpf: null,
          needsCpf: false,
          authorizedPayments: authorizedPaymentsFor(customer),
          lastPayment: recent[0]?.payments[0]?.code ?? null,
        }
      : {
          id: null,
          name: null,
          savedAddresses: [],
          cpf: null,
          // CPF só se a nota exigir; cliente antigo já tem cadastro.
          needsCpf: ctx.settings?.cpfRequired ?? false,
          authorizedPayments: [],
          lastPayment: null,
        },
  };

  const notices: string[] = customer ? [] : ['Oi! Vou anotar seu pedido.'];
  const [last] = recent;
  const [lastItem] = last?.items ?? [];
  if (last && lastItem) {
    const product = sellable(offer.catalog).find(
      (p) => p.id === lastItem.productId,
    );
    const lastPayment = last.payments[0]?.code;
    const paymentStillAccepted = paymentOptions(draft, offer).some(
      (t) => t.code === lastPayment,
    );
    if (!product) {
      notices.push(
        `O ${lastItem.description} do seu último pedido está em falta agora.`,
      );
    }
    draft = {
      ...draft,
      item: product ? { ...lastItem, description: product.description } : null,
      address: deliverable(last.address ?? savedAddresses[0], offer, notices),
      payment: paymentStillAccepted && lastPayment ? lastPayment : null,
      fromLastOrder: Boolean(product),
    };
  } else if (customer) {
    draft = {
      ...draft,
      address: deliverable(savedAddresses[0], offer, notices),
    };
  }

  const applied = applySignal(draft, signal, offer);
  if (applied.outsideCoverage) {
    return outsideCoverage(applied.draft, offer, [
      ...notices,
      ...applied.notices,
    ]);
  }
  const firstName = customer?.name.split(' ')[0];
  const header = applied.draft.fromLastOrder
    ? `Oi${firstName ? `, ${firstName}` : ''}! Mesmo pedido de sempre?`
    : undefined;

  return advance(
    applied.draft,
    offer,
    [...notices, ...applied.notices],
    [{ type: 'customer_identified', customerId: customer?.id ?? null }],
    header,
  );
};

/**
 * Endereço do último pedido ou do cadastro, se ainda estiver na área de
 * entrega. Fora dela, avisa e deixa o cliente escolher (issue #11).
 */
function deliverable(
  address: Address | null | undefined,
  offer: Offer,
  notices: string[],
): Address | null {
  if (!address) return null;
  if (isCovered(address, offer.coverage ?? NO_COVERAGE_RULES)) return address;
  notices.push(`Ainda não entregamos em ${address.neighborhood}.`);
  return null;
}
