import { GameEngine, PHASES } from '../src/game-engine.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { RLAdapter } from '../src/rl-adapter.js';
import { chooseEvaluationAction, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { mulberry32 } from './genetics.mjs';

// Character-bound evaluation only needs the two seat arrangements.
export const MATCH_VARIANTS = Object.freeze([
  { characters: ['madoka', 'mami'], label: 'madoka-first', madokaSeat: 0 },
  { characters: ['mami', 'madoka'], label: 'madoka-second', madokaSeat: 1 },
]);

export function playGame(madokaGenome, mamiGenome, { variant = 0, seed = 1, maxActions = 600 } = {}) {
  const genomes = {
    madoka: normalizeEvaluationGenome(madokaGenome),
    mami: normalizeEvaluationGenome(mamiGenome),
  };
  const setup = MATCH_VARIANTS[variant % MATCH_VARIANTS.length];
  const rng = mulberry32(seed);
  const players = setup.characters.map((id, i) => ({ id: `p${i}`, name: CHARACTERS[id].name, character: CHARACTERS[id] }));
  const engine = new GameEngine({ players, decks: setup.characters.map(createDeck), rng });
  const adapter = new RLAdapter(engine);
  let actions = 0;

  while (engine.state.phase !== PHASES.GAME_OVER && actions < maxActions) {
    const player = adapter.currentPlayer();
    const character = engine.player(player).character.id;
    const action = chooseEvaluationAction(adapter, player, genomes[character], rng);
    adapter.applyAction(action, player);
    actions += 1;
  }

  const winnerPlayer = engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null;
  const winnerCharacter = winnerPlayer === null ? null : engine.player(winnerPlayer).character.id;
  return {
    variant: setup.label,
    winnerCharacter,
    winnerPlayer,
    actions,
    turn: engine.state.turn,
    truncated: winnerPlayer === null,
    madokaSeat: setup.madokaSeat,
    mamiSeat: 1 - setup.madokaSeat,
  };
}

export function playSeries(madokaGenome, mamiGenome, { seed = 1, repeats = 1, maxActions = 600 } = {}) {
  const result = { games: 0, winsMadoka: 0, winsMami: 0, draws: 0, truncated: 0, details: [] };
  let game = 0;
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (let variant = 0; variant < MATCH_VARIANTS.length; variant++) {
      const detail = playGame(madokaGenome, mamiGenome, { variant, seed: seed + game * 7919, maxActions });
      result.games += 1;
      if (detail.winnerCharacter === 'madoka') result.winsMadoka += 1;
      else if (detail.winnerCharacter === 'mami') result.winsMami += 1;
      else result.draws += 1;
      if (detail.truncated) result.truncated += 1;
      result.details.push(detail);
      game += 1;
    }
  }
  return result;
}
