import { ACTIVE_GENOME } from './evolved-genome.js';
import { DEFAULT_GENOME, chooseEvaluationAction, normalizeEvaluationGenome } from './evaluation-ai.js';

const publishedGenome = ACTIVE_GENOME ? normalizeEvaluationGenome(ACTIVE_GENOME) : DEFAULT_GENOME;

// Built-in browser opponent. The same interpretable evaluation policy is used by the GA trainer.
export function chooseBaselineAction(adapter, player = adapter.currentPlayer()) {
  return chooseEvaluationAction(adapter, player, publishedGenome);
}

export function baselineGenome() {
  return publishedGenome;
}
