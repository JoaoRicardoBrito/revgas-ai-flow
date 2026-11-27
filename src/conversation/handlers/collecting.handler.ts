import { applySignal, askFor, missingField } from '../draft.js';
import {
  advance,
  canceledBeforeSale,
  loadOffer,
  misunderstood,
  type StepHandler,
} from './handler.js';

/** Falta algum dado: aplica o turno e pergunta o próximo campo. */
export const collectingHandler: StepHandler = async (state, signal, ctx) => {
  if (signal.intent === 'cancel') return canceledBeforeSale(state.draft);

  const offer = await loadOffer(ctx);
  const applied = applySignal(state.draft, signal, offer);
  const progressed =
    JSON.stringify(applied.draft) !== JSON.stringify(state.draft);

  if (!progressed && applied.notices.length === 0) {
    const field = missingField(state.draft) ?? 'product';
    return misunderstood(state, askFor(field, state.draft, offer));
  }
  return advance(
    { ...applied.draft, misunderstandings: 0 },
    offer,
    applied.notices,
  );
};
