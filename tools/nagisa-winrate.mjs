import { GameEngine, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';

function rngFor(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function play(ids, seed, maxActions = 1000) {
  const engine = new GameEngine({
    players: ids.map((id, i) => ({ id: `p${i}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng: rngFor(seed),
  });
  const adapter = new CharacterAdapter(engine);
  let steps = 0;
  while (engine.state.phase !== PHASES.GAME_OVER && steps < maxActions) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) throw new Error(`No legal actions at step ${steps}: ${ids.join(' vs ')}`);
    const action = chooseBaselineAction(adapter, player);
    if (action === null || !legal.includes(action)) throw new Error(`Illegal AI action ${action} at step ${steps}: ${ids.join(' vs ')}`);
    adapter.applyAction(action, player);
    steps++;
  }
  return engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null;
}

const opponents = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura'];
const gamesPerMatchup = 1000;
const half = gamesPerMatchup / 2;
const results = [];

for (let oi = 0; oi < opponents.length; oi++) {
  const opponent = opponents[oi];
  let wins = 0, losses = 0, draws = 0, firstWins = 0, secondWins = 0;
  for (let i = 0; i < half; i++) {
    const winner = play(['nagisa', opponent], 1000000 + oi * 100000 + i);
    if (winner === 0) { wins++; firstWins++; }
    else if (winner === 1) losses++;
    else draws++;
  }
  for (let i = 0; i < half; i++) {
    const winner = play([opponent, 'nagisa'], 2000000 + oi * 100000 + i);
    if (winner === 1) { wins++; secondWins++; }
    else if (winner === 0) losses++;
    else draws++;
  }
  results.push({
    opponent,
    games: gamesPerMatchup,
    wins,
    losses,
    draws,
    winRate: wins / gamesPerMatchup,
    firstSeatWinRate: firstWins / half,
    secondSeatWinRate: secondWins / half,
  });
}

console.log('NAGISA_WINRATE_RESULT=' + JSON.stringify(results));
