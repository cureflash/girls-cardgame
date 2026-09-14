import { GameEngine, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { DEFAULT_GENOME, chooseEvaluationAction, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { baselineGenome, chooseBaselineAction } from '../src/baseline-ai.js';
import { NAGISA_GENOME } from '../src/nagisa-policy.js';
import { SAYAKA_GENOME, KYOKO_GENOME, HOMURA_GENOME } from '../src/remaining-policies.js';
import { cloneGenome, mutate, mulberry32, randomGenome } from '../ga/genetics.mjs';

const targetCharacter = process.env.CHARACTER ?? process.argv[2];
if (!['madoka', 'mami'].includes(targetCharacter)) {
  throw new Error('CHARACTER must be madoka or mami');
}

const roster = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura', 'nagisa'];
const opponents = roster.filter(id => id !== targetCharacter);
const POPULATION = 18;
const GENERATIONS = 7;
const TRAIN_GAMES_PER_OPPONENT = 20;
const FINALIST_GAMES_PER_OPPONENT = 400;
const FINAL_GAMES_PER_OPPONENT = 1000;
const MAX_ACTIONS = 1200;

function rngFor(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function playGame(ids, candidateSeat, candidate, seed) {
  const engineRng = rngFor(seed);
  const candidateRng = rngFor(seed ^ 0x9e3779b9);
  const opponentRng = rngFor(seed ^ 0x85ebca6b);
  const engine = new GameEngine({
    players: ids.map((id, i) => ({ id: `p${i}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng: engineRng,
  });
  const adapter = new CharacterAdapter(engine);
  let actions = 0;
  while (engine.state.phase !== PHASES.GAME_OVER && actions < MAX_ACTIONS) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) throw new Error(`No legal action at ${actions} for ${ids.join(' vs ')}`);
    const action = player === candidateSeat
      ? chooseEvaluationAction(adapter, player, candidate, candidateRng)
      : chooseBaselineAction(adapter, player, opponentRng);
    if (action === null || !legal.includes(action)) {
      throw new Error(`Illegal action ${action} at ${actions} for ${ids.join(' vs ')}`);
    }
    adapter.applyAction(action, player);
    actions++;
  }
  return {
    winner: engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null,
    truncated: engine.state.phase !== PHASES.GAME_OVER,
  };
}

function matchup(candidate, opponent, games, seedBase) {
  const half = Math.floor(games / 2);
  let wins = 0, losses = 0, draws = 0, truncated = 0;
  for (let i = 0; i < half; i++) {
    const r = playGame([targetCharacter, opponent], 0, candidate, seedBase + i);
    truncated += r.truncated ? 1 : 0;
    if (r.winner === 0) wins++; else if (r.winner === 1) losses++; else draws++;
  }
  for (let i = 0; i < games - half; i++) {
    const r = playGame([opponent, targetCharacter], 1, candidate, seedBase + 100000 + i);
    truncated += r.truncated ? 1 : 0;
    if (r.winner === 1) wins++; else if (r.winner === 0) losses++; else draws++;
  }
  return { opponent, games, wins, losses, draws, truncated, winRate: wins / games };
}

function evaluate(candidate, gamesPerOpponent, seedBase) {
  const rows = opponents.map((opponent, i) => matchup(candidate, opponent, gamesPerOpponent, seedBase + i * 1_000_000));
  const games = rows.reduce((s, row) => s + row.games, 0);
  const wins = rows.reduce((s, row) => s + row.wins, 0);
  const losses = rows.reduce((s, row) => s + row.losses, 0);
  const draws = rows.reduce((s, row) => s + row.draws, 0);
  const truncated = rows.reduce((s, row) => s + row.truncated, 0);
  return { games, wins, losses, draws, truncated, winRate: wins / games, rows };
}

const searchRng = mulberry32(targetCharacter === 'madoka' ? 0x4d41444f : 0x4d414d49);
const seeds = [
  cloneGenome(baselineGenome(targetCharacter), { id: `${targetCharacter}-retrain-seed-current` }),
  cloneGenome(baselineGenome(targetCharacter === 'madoka' ? 'mami' : 'madoka'), { id: `${targetCharacter}-retrain-seed-other-core` }),
  cloneGenome(DEFAULT_GENOME, { id: `${targetCharacter}-retrain-seed-default` }),
  cloneGenome(SAYAKA_GENOME, { id: `${targetCharacter}-retrain-seed-sayaka` }),
  cloneGenome(KYOKO_GENOME, { id: `${targetCharacter}-retrain-seed-kyoko` }),
  cloneGenome(HOMURA_GENOME, { id: `${targetCharacter}-retrain-seed-homura` }),
  cloneGenome(NAGISA_GENOME, { id: `${targetCharacter}-retrain-seed-nagisa` }),
];

let population = [...seeds];
while (population.length < POPULATION) {
  const parent = seeds[population.length % seeds.length];
  population.push(population.length < 14
    ? mutate(cloneGenome(parent, { id: `${targetCharacter}-retrain-seed-mut-${population.length}` }), searchRng, { rate: 0.5, sigma: 0.45 })
    : randomGenome(searchRng, { id: `${targetCharacter}-retrain-random-${population.length}`, broad: true }));
}

const hall = [];
for (let generation = 0; generation < GENERATIONS; generation++) {
  const scored = population.map(candidate => ({
    candidate,
    result: evaluate(candidate, TRAIN_GAMES_PER_OPPONENT, 140_000_000 + generation * 20_000_000),
  })).sort((a, b) => b.result.winRate - a.result.winRate || a.result.truncated - b.result.truncated);
  const top = scored.slice(0, 5);
  hall.push({
    candidate: cloneGenome(top[0].candidate, { id: `${top[0].candidate.id}-hall-g${generation}` }),
    fitness: top[0].result.winRate,
  });
  console.log('CORE_AI_GENERATION=' + JSON.stringify({
    character: targetCharacter,
    generation,
    top: top.map(item => ({ id: item.candidate.id, fitness: item.result.winRate })),
  }));

  const elites = top.slice(0, 4).map(item => item.candidate);
  const next = elites.map((candidate, i) => cloneGenome(candidate, { id: `${targetCharacter}-retrain-g${generation + 1}-elite-${i}` }));
  while (next.length < POPULATION - 3) {
    const parent = elites[Math.floor(searchRng() * elites.length)];
    next.push(mutate(
      cloneGenome(parent, { id: `${targetCharacter}-retrain-g${generation + 1}-child-${next.length}` }),
      searchRng,
      { rate: 0.45, sigma: 0.32 },
    ));
  }
  while (next.length < POPULATION) {
    next.push(randomGenome(searchRng, { id: `${targetCharacter}-retrain-g${generation + 1}-immigrant-${next.length}`, broad: true }));
  }
  population = next;
}

const finalPool = [...hall.map(item => item.candidate), ...population.slice(0, 4)];
const finalists = finalPool.map((candidate, i) => ({
  candidate,
  result: evaluate(candidate, FINALIST_GAMES_PER_OPPONENT, 640_000_000 + i * 10_000_000),
})).sort((a, b) => b.result.winRate - a.result.winRate || a.result.truncated - b.result.truncated);

console.log('CORE_AI_FINALISTS=' + JSON.stringify({
  character: targetCharacter,
  finalists: finalists.slice(0, 6).map(item => ({
    id: item.candidate.id,
    fitness: item.result.winRate,
    rows: item.result.rows.map(row => ({ opponent: row.opponent, winRate: row.winRate })),
  })),
}));

const champion = finalists[0].candidate;
const final = evaluate(champion, FINAL_GAMES_PER_OPPONENT, 940_000_000);
console.log('CORE_AI_RESULT=' + JSON.stringify({
  character: targetCharacter,
  id: `${targetCharacter}-dedicated-shield-v1`,
  sourceId: champion.id,
  weights: normalizeEvaluationGenome(champion).weights,
  result: {
    ...final,
    rows: final.rows.map(row => ({ opponent: row.opponent, games: row.games, wins: row.wins, losses: row.losses, draws: row.draws, winRate: row.winRate, truncated: row.truncated })),
  },
}));
