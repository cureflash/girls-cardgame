import { GameEngine, PHASES } from '../src/game-engine.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { RLAdapter } from '../src/rl-adapter.js';
import { chooseEvaluationAction, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { mulberry32 } from './genetics.mjs';

export const MATCH_VARIANTS = Object.freeze([
  { characters: ['madoka', 'mami'], controllers: [0, 1], label: 'A-madoka-first' },
  { characters: ['madoka', 'mami'], controllers: [1, 0], label: 'A-mami-second' },
  { characters: ['mami', 'madoka'], controllers: [0, 1], label: 'A-mami-first' },
  { characters: ['mami', 'madoka'], controllers: [1, 0], label: 'A-madoka-second' },
]);

export function playGame(genomeA, genomeB, { variant = 0, seed = 1, maxActions = 600 } = {}) {
  const genomes = [normalizeEvaluationGenome(genomeA), normalizeEvaluationGenome(genomeB)];
  const setup = MATCH_VARIANTS[variant % MATCH_VARIANTS.length];
  const rng = mulberry32(seed);
  const players = setup.characters.map((id, i) => ({ id: `p${i}`, name: CHARACTERS[id].name, character: CHARACTERS[id] }));
  const engine = new GameEngine({ players, decks: setup.characters.map(createDeck), rng });
  const adapter = new RLAdapter(engine);
  let actions = 0;

  while (engine.state.phase !== PHASES.GAME_OVER && actions < maxActions) {
    const player = adapter.currentPlayer();
    const controller = setup.controllers[player];
    const action = chooseEvaluationAction(adapter, player, genomes[controller], rng);
    adapter.applyAction(action, player);
    actions += 1;
  }

  const winnerPlayer = engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null;
  const winnerController = winnerPlayer === null ? null : setup.controllers[winnerPlayer];
  const aPlayer = setup.controllers[0] === 0 ? 0 : 1;
  return {
    variant: setup.label,
    winnerController,
    winnerPlayer,
    actions,
    turn: engine.state.turn,
    truncated: winnerPlayer === null,
    aCharacter: setup.characters[aPlayer],
    aSeat: aPlayer,
  };
}

export function playSeries(genomeA, genomeB, { seed = 1, repeats = 1, maxActions = 600 } = {}) {
  const result = { games: 0, winsA: 0, winsB: 0, draws: 0, truncated: 0, details: [] };
  let game = 0;
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (let variant = 0; variant < MATCH_VARIANTS.length; variant++) {
      const detail = playGame(genomeA, genomeB, { variant, seed: seed + game * 7919, maxActions });
      result.games += 1;
      if (detail.winnerController === 0) result.winsA += 1;
      else if (detail.winnerController === 1) result.winsB += 1;
      else result.draws += 1;
      if (detail.truncated) result.truncated += 1;
      result.details.push(detail);
      game += 1;
    }
  }
  return result;
}
