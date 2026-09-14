import { ACTIVE_GENOMES } from './evolved-genome.js?v=g999';
import { DEFAULT_GENOME, chooseEvaluationAction, normalizeEvaluationGenome } from './evaluation-ai.js';
import { chooseNagisaAction } from './nagisa-ai.js';
import { chooseRemainingCharacterAction } from './remaining-ai.js';

const publishedGenomes = Object.freeze({
  madoka: ACTIVE_GENOMES?.madoka ? normalizeEvaluationGenome(ACTIVE_GENOMES.madoka) : DEFAULT_GENOME,
  mami: ACTIVE_GENOMES?.mami ? normalizeEvaluationGenome(ACTIVE_GENOMES.mami) : DEFAULT_GENOME,
});

function genomeFor(adapter, player) {
  const character = adapter.engine.player(player).character?.id;
  return publishedGenomes[character] ?? DEFAULT_GENOME;
}

// Built-in browser opponent. Every current character now has its own policy path:
// Madoka/Mami use evolved evaluation genomes, Nagisa uses forced-battle tactics,
// and Sayaka/Kyoko/Homura use trained evaluation genomes plus character-specific tactics.
export function chooseBaselineAction(adapter, player = adapter.currentPlayer(), rng = Math.random) {
  const nagisaAction = chooseNagisaAction(adapter, player, rng);
  if (nagisaAction !== null) return nagisaAction;
  const dedicatedAction = chooseRemainingCharacterAction(adapter, player, rng);
  if (dedicatedAction !== null) return dedicatedAction;
  return chooseEvaluationAction(adapter, player, genomeFor(adapter, player), rng);
}

export function baselineGenome(characterId) {
  return characterId ? (publishedGenomes[characterId] ?? DEFAULT_GENOME) : publishedGenomes;
}
