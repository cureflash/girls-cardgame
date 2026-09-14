import { GameEngine, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';

const characters = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura', 'nagisa'];
const GAMES_PER_PAIR = 1000;
const MAX_ACTIONS = 900;

function rngFor(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function play(ids, seed) {
  const engineRng = rngFor(seed);
  const policyRng = rngFor(seed ^ 0x9e3779b9);
  const engine = new GameEngine({
    players: ids.map((id, index) => ({ id: `p${index}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng: engineRng,
  });
  const adapter = new CharacterAdapter(engine);
  let actions = 0;

  while (engine.state.phase !== PHASES.GAME_OVER && actions < MAX_ACTIONS) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) throw new Error(`No legal actions at ${actions}: ${ids.join(' vs ')}`);
    const action = chooseBaselineAction(adapter, player, policyRng);
    if (action === null || !legal.includes(action)) {
      throw new Error(`Illegal AI action ${action} at ${actions}: ${ids.join(' vs ')}`);
    }
    adapter.applyAction(action, player);
    actions++;
  }

  return {
    winner: engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null,
    truncated: engine.state.phase !== PHASES.GAME_OVER,
    actions,
  };
}

const totals = Object.fromEntries(characters.map(id => [id, { games: 0, wins: 0, losses: 0, draws: 0, truncated: 0 }]));
const pairs = [];
let pairIndex = 0;

for (let a = 0; a < characters.length; a++) {
  for (let b = a + 1; b < characters.length; b++) {
    const charA = characters[a];
    const charB = characters[b];
    let winsA = 0, winsB = 0, draws = 0, truncated = 0;
    const half = GAMES_PER_PAIR / 2;
    const seedBase = 100_000_000 + pairIndex * 2_000_000;

    for (let i = 0; i < half; i++) {
      const result = play([charA, charB], seedBase + i);
      if (result.winner === 0) winsA++;
      else if (result.winner === 1) winsB++;
      else draws++;
      if (result.truncated) truncated++;
    }
    for (let i = 0; i < half; i++) {
      const result = play([charB, charA], seedBase + 1_000_000 + i);
      if (result.winner === 1) winsA++;
      else if (result.winner === 0) winsB++;
      else draws++;
      if (result.truncated) truncated++;
    }

    totals[charA].games += GAMES_PER_PAIR;
    totals[charA].wins += winsA;
    totals[charA].losses += winsB;
    totals[charA].draws += draws;
    totals[charA].truncated += truncated;
    totals[charB].games += GAMES_PER_PAIR;
    totals[charB].wins += winsB;
    totals[charB].losses += winsA;
    totals[charB].draws += draws;
    totals[charB].truncated += truncated;

    const row = {
      a: charA,
      b: charB,
      games: GAMES_PER_PAIR,
      winsA,
      winsB,
      draws,
      truncated,
      winRateA: winsA / GAMES_PER_PAIR,
      winRateB: winsB / GAMES_PER_PAIR,
    };
    pairs.push(row);
    console.log('SIX_AI_PAIR=' + JSON.stringify(row));
    pairIndex++;
  }
}

const standings = characters.map(character => ({
  character,
  ...totals[character],
  winRate: totals[character].wins / totals[character].games,
})).sort((a, b) => b.winRate - a.winRate);

console.log('SIX_AI_ROUNDROBIN_RESULT=' + JSON.stringify({
  gamesPerPair: GAMES_PER_PAIR,
  totalGames: pairs.length * GAMES_PER_PAIR,
  pairs,
  standings,
}));
