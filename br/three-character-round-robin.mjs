import fs from 'node:fs';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { GameEngine, PHASES } from '../src/three-character-engine.js';
import { ThreeCharacterAdapter } from '../src/three-character-adapter.js';
import { ACTIONS } from '../src/rl-adapter.js';
import { DEFAULT_GENOME, chooseEvaluationAction } from '../src/evaluation-ai.js';
import { mulberry32 } from '../ga/genetics.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function recycleValue(card) {
  if (!card) return -Infinity;
  if (card.type === 'witch') return 100 + (card.attack ?? 0);
  if (card.effect === 'nullifyDamage') return 95;
  if (card.effect === 'boost') return 80 + (card.value ?? 0);
  if (card.type === 'familiar') return 60 + (card.attack ?? 0);
  return 0;
}

function chooseAction(adapter, player, rng, sayakaSpecialThreshold, stats) {
  const engine = adapter.engine;
  const p = engine.player(player);
  const legal = adapter.legalActions(player);
  if (!legal.length) throw new Error('No legal action.');
  if (legal.length === 1) return legal[0];

  if (engine.state.pendingDecision?.type === 'SAYAKA_RECYCLE') {
    return [...legal].sort((a, b) => {
      const ca = p.graveyard[a - ACTIONS.REVIVE_BASE];
      const cb = p.graveyard[b - ACTIONS.REVIVE_BASE];
      return recycleValue(cb) - recycleValue(ca) || a - b;
    })[0];
  }

  if (p.character?.id === 'sayaka' && legal.includes(ACTIONS.SPECIAL) && p.deck.length <= sayakaSpecialThreshold) {
    stats.sayakaSpecials += 1;
    return ACTIONS.SPECIAL;
  }

  let action = chooseEvaluationAction(adapter, player, DEFAULT_GENOME, rng);
  if (!legal.includes(action)) action = legal[0];
  return action;
}

function playGame(a, b, { seed, aFirst, maxActions, sayakaSpecialThreshold }) {
  const ids = aFirst ? [a, b] : [b, a];
  const rng = mulberry32(seed);
  const engine = new GameEngine({
    players: ids.map((id, index) => ({ id: `p${index}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng,
  });
  const adapter = new ThreeCharacterAdapter(engine);
  const stats = { sayakaSpecials: 0 };
  let actions = 0;

  while (engine.state.phase !== PHASES.GAME_OVER && actions < maxActions) {
    const player = adapter.currentPlayer();
    const action = chooseAction(adapter, player, rng, sayakaSpecialThreshold, stats);
    adapter.applyAction(action, player);
    actions += 1;
  }

  const winner = engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null;
  return {
    winner: winner === null ? null : engine.player(winner).character.id,
    first: ids[0],
    second: ids[1],
    actions,
    turn: engine.state.turn,
    truncated: winner === null,
    sayakaSpecials: stats.sayakaSpecials,
  };
}

function playPair(a, b, { games, seed, maxActions, sayakaSpecialThreshold }) {
  const result = {
    a, b, games,
    wins: { [a]: 0, [b]: 0 },
    draws: 0,
    truncated: 0,
    sayakaSpecials: 0,
    bySeat: {
      [a]: { first: { games: 0, wins: 0 }, second: { games: 0, wins: 0 } },
      [b]: { first: { games: 0, wins: 0 }, second: { games: 0, wins: 0 } },
    },
  };
  for (let game = 0; game < games; game++) {
    const aFirst = game % 2 === 0;
    const detail = playGame(a, b, {
      seed: seed + game * 7919,
      aFirst,
      maxActions,
      sayakaSpecialThreshold,
    });
    result.sayakaSpecials += detail.sayakaSpecials;
    result.truncated += Number(detail.truncated);
    if (detail.winner) result.wins[detail.winner] += 1;
    else result.draws += 1;
    for (const id of [a, b]) {
      const seat = detail.first === id ? 'first' : 'second';
      result.bySeat[id][seat].games += 1;
      result.bySeat[id][seat].wins += Number(detail.winner === id);
    }
  }
  result.winRates = {
    [a]: result.wins[a] / games,
    [b]: result.wins[b] / games,
  };
  return result;
}

function tuneSayakaThreshold({ games, seed, maxActions, thresholds }) {
  const rows = [];
  for (const threshold of thresholds) {
    let wins = 0;
    let total = 0;
    let specials = 0;
    for (const [i, opponent] of ['madoka', 'mami'].entries()) {
      const result = playPair('sayaka', opponent, {
        games,
        seed: seed + i * 10_000_019 + threshold * 1009,
        maxActions,
        sayakaSpecialThreshold: threshold,
      });
      wins += result.wins.sayaka;
      total += result.games;
      specials += result.sayakaSpecials;
    }
    rows.push({ threshold, wins, games: total, winRate: wins / total, specials });
  }
  rows.sort((a, b) => b.winRate - a.winRate || a.threshold - b.threshold);
  return rows;
}

const output = arg('output', '/tmp/three-character-round-robin.json');
const games = Number(arg('games', 600));
const tuningGames = Number(arg('tuning-games', 120));
const seed = Number(arg('seed', 2026091403));
const maxActions = Number(arg('max-actions', 300));
const thresholds = [3, 5, 7, 9, 12, 15, 30];

const tuning = tuneSayakaThreshold({ games: tuningGames, seed, maxActions, thresholds });
const sayakaSpecialThreshold = tuning[0].threshold;
const pairs = [
  ['madoka', 'mami'],
  ['madoka', 'sayaka'],
  ['mami', 'sayaka'],
];
const pairResults = pairs.map(([a, b], index) => playPair(a, b, {
  games,
  seed: seed + 50_000_003 + index * 20_000_033,
  maxActions,
  sayakaSpecialThreshold,
}));

const aggregate = Object.fromEntries(['madoka', 'mami', 'sayaka'].map(id => [id, { games: 0, wins: 0, losses: 0, draws: 0 }]));
for (const pair of pairResults) {
  for (const id of [pair.a, pair.b]) {
    const other = id === pair.a ? pair.b : pair.a;
    aggregate[id].games += pair.games;
    aggregate[id].wins += pair.wins[id];
    aggregate[id].losses += pair.wins[other];
    aggregate[id].draws += pair.draws;
  }
}
for (const row of Object.values(aggregate)) row.winRate = row.wins / row.games;

const report = {
  format: 'girls-cardgame-three-character-round-robin-v1',
  policy: 'shared-default-evaluation-v1',
  deckCondition: 'Sayaka uses Madoka mirrored 30-card numerical pool; only character abilities differ.',
  sayakaRule: {
    passive: 'witch tribute threshold -1',
    special: 'return any 3 graveyard cards to bottom of deck, then end turn',
    specialThresholdTuning: tuning,
    selectedSpecialThreshold: sayakaSpecialThreshold,
  },
  gamesPerPair: games,
  tuningGamesPerSayakaMatchup: tuningGames,
  seed,
  maxActions,
  pairResults,
  aggregate,
};

fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  selectedSpecialThreshold: sayakaSpecialThreshold,
  tuning,
  pairs: pairResults.map(pair => ({ matchup: `${pair.a}-vs-${pair.b}`, wins: pair.wins, draws: pair.draws, truncated: pair.truncated, winRates: pair.winRates, sayakaSpecials: pair.sayakaSpecials })),
  aggregate,
  output,
}, null, 2));
