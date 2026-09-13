import { ACTIVE_GENOMES } from './evolved-genome.js?v=g999';
import { DEFAULT_GENOME, chooseEvaluationAction, normalizeEvaluationGenome } from './evaluation-ai.js';

const publishedGenomes = Object.freeze({
  madoka: ACTIVE_GENOMES?.madoka ? normalizeEvaluationGenome(ACTIVE_GENOMES.madoka) : DEFAULT_GENOME,
  mami: ACTIVE_GENOMES?.mami ? normalizeEvaluationGenome(ACTIVE_GENOMES.mami) : DEFAULT_GENOME,
});

function genomeFor(adapter, player) {
  const character = adapter.engine.player(player).character?.id;
  return publishedGenomes[character] ?? DEFAULT_GENOME;
}

// Built-in browser opponent. Madoka and Mami use separately evolved evaluation policies.
export function chooseBaselineAction(adapter, player = adapter.currentPlayer()) {
  return chooseEvaluationAction(adapter, player, genomeFor(adapter, player));
}

export function baselineGenome(characterId) {
  return characterId ? (publishedGenomes[characterId] ?? DEFAULT_GENOME) : publishedGenomes;
}
