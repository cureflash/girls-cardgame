import { GameEngine, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { ACTIONS } from '../src/rl-adapter.js';
import { DEFAULT_GENOME, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { baselineGenome, chooseBaselineAction } from '../src/baseline-ai.js';
import { chooseNagisaActionWithPolicy } from '../src/nagisa-ai.js';
import { NAGISA_GENOME } from '../src/nagisa-policy.js';
import { SAYAKA_GENOME, KYOKO_GENOME, HOMURA_GENOME } from '../src/remaining-policies.js';
import { cloneGenome, mutate, mulberry32, randomGenome } from '../ga/genetics.mjs';

const opponents = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura'];
const POPULATION = 18;
const GENERATIONS = 7;
const TRAIN_GAMES_PER_OPPONENT = 20;
const FINALIST_GAMES_PER_OPPONENT = 400;
const FINAL_GAMES_PER_OPPONENT = 1000;
const MAX_ACTIONS = 1200;
const THRESHOLD_SEEDS = [80, 140, 200, 280, 360, 480, 640];

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
  let specials = 0;
  while (engine.state.phase !== PHASES.GAME_OVER && actions < MAX_ACTIONS) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) throw new Error(`No legal action at ${actions} for ${ids.join(' vs ')}`);
    const action = player === candidateSeat
      ? chooseNagisaActionWithPolicy(adapter, player, candidate, candidateRng)
      : chooseBaselineAction(adapter, player, opponentRng);
    if (action === null || !legal.includes(action)) {
      throw new Error(`Illegal action ${action} at ${actions} for ${ids.join(' vs ')}`);
    }
    if (player === candidateSeat && action === ACTIONS.SPECIAL) specials++;
    adapter.applyAction(action, player);
    actions++;
  }
  return {
    winner: engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null,
    truncated: engine.state.phase !== PHASES.GAME_OVER,
    specials,
  };
}

function matchup(candidate, opponent, games, seedBase) {
  const half = Math.floor(games / 2);
  let wins = 0, losses = 0, draws = 0, truncated = 0, specials = 0;
  for (let i = 0; i < half; i++) {
    const r = playGame(['nagisa', opponent], 0, candidate, seedBase + i);
    specials += r.specials; truncated += r.truncated ? 1 : 0;
    if (r.winner === 0) wins++; else if (r.winner === 1) losses++; else draws++;
  }
  for (let i = 0; i < games - half; i++) {
    const r = playGame([opponent, 'nagisa'], 1, candidate, seedBase + 100000 + i);
    specials += r.specials; truncated += r.truncated ? 1 : 0;
    if (r.winner === 1) wins++; else if (r.winner === 0) losses++; else draws++;
  }
  return { opponent, games, wins, losses, draws, truncated, specials, winRate: wins / games };
}

function evaluate(candidate, gamesPerOpponent, seedBase) {
  const rows = opponents.map((opponent, i) => matchup(candidate, opponent, gamesPerOpponent, seedBase + i * 1_000_000));
  const games = rows.reduce((s, row) => s + row.games, 0);
  const wins = rows.reduce((s, row) => s + row.wins, 0);
  const losses = rows.reduce((s, row) => s + row.losses, 0);
  const draws = rows.reduce((s, row) => s + row.draws, 0);
  const truncated = rows.reduce((s, row) => s + row.truncated, 0);
  const specials = rows.reduce((s, row) => s + row.specials, 0);
  return { games, wins, losses, draws, truncated, specials, winRate: wins / games, rows };
}

const searchRng = mulberry32(0x4e414732);
const seeds = [
  cloneGenome(NAGISA_GENOME, { id: 'nagisa-v2-seed-current' }),
  cloneGenome(DEFAULT_GENOME, { id: 'nagisa-v2-seed-default' }),
  cloneGenome(baselineGenome('madoka'), { id: 'nagisa-v2-seed-madoka' }),
  cloneGenome(baselineGenome('mami'), { id: 'nagisa-v2-seed-mami' }),
  cloneGenome(SAYAKA_GENOME, { id: 'nagisa-v2-seed-sayaka' }),
  cloneGenome(KYOKO_GENOME, { id: 'nagisa-v2-seed-kyoko' }),
  cloneGenome(HOMURA_GENOME, { id: 'nagisa-v2-seed-homura' }),
];

let population = seeds.map((genome, i) => ({ genome, threshold: THRESHOLD_SEEDS[i % THRESHOLD_SEEDS.length] }));
while (population.length < POPULATION) {
  const parent = seeds[population.length % seeds.length];
  const genome = population.length < 14
    ? mutate(cloneGenome(parent, { id: `nagisa-v2-seed-mut-${population.length}` }), searchRng, { rate: 0.5, sigma: 0.45 })
    : randomGenome(searchRng, { id: `nagisa-v2-random-${population.length}`, broad: true });
  population.push({ genome, threshold: THRESHOLD_SEEDS[population.length % THRESHOLD_SEEDS.length] });
}

const hall = [];
for (let generation = 0; generation < GENERATIONS; generation++) {
  const scored = population.map(candidate => ({
    candidate,
    result: evaluate(candidate, TRAIN_GAMES_PER_OPPONENT, 120_000_000 + generation * 20_000_000),
  })).sort((a, b) => b.result.winRate - a.result.winRate || a.result.truncated - b.result.truncated);
  const top = scored.slice(0, 5);
  hall.push({
    candidate: {
      genome: cloneGenome(top[0].candidate.genome, { id: `${top[0].candidate.genome.id}-hall-g${generation}` }),
      threshold: top[0].candidate.threshold,
    },
    fitness: top[0].result.winRate,
  });
  console.log('NAGISA_V2_GENERATION=' + JSON.stringify({
    generation,
    top: top.map(item => ({ id: item.candidate.genome.id, threshold: item.candidate.threshold, fitness: item.result.winRate })),
  }));

  const elites = top.slice(0, 4).map(item => item.candidate);
  const next = elites.map((candidate, i) => ({
    genome: cloneGenome(candidate.genome, { id: `nagisa-v2-g${generation + 1}-elite-${i}` }),
    threshold: candidate.threshold,
  }));
  while (next.length < POPULATION - 3) {
    const parent = elites[Math.floor(searchRng() * elites.length)];
    next.push({
      genome: mutate(cloneGenome(parent.genome, { id: `nagisa-v2-g${generation + 1}-child-${next.length}` }), searchRng, { rate: 0.45, sigma: 0.32 }),
      threshold: Math.max(0, Math.min(1200, parent.threshold + (Math.floor(searchRng() * 7) - 3) * 40)),
    });
  }
  while (next.length < POPULATION) {
    next.push({
      genome: randomGenome(searchRng, { id: `nagisa-v2-g${generation + 1}-immigrant-${next.length}`, broad: true }),
      threshold: THRESHOLD_SEEDS[Math.floor(searchRng() * THRESHOLD_SEEDS.length)],
    });
  }
  population = next;
}

const finalPool = [...hall.map(item => item.candidate), ...population.slice(0, 4)];
const finalists = finalPool.map((candidate, i) => ({
  candidate,
  result: evaluate(candidate, FINALIST_GAMES_PER_OPPONENT, 620_000_000 + i * 10_000_000),
})).sort((a, b) => b.result.winRate - a.result.winRate || a.result.truncated - b.result.truncated);

console.log('NAGISA_V2_FINALISTS=' + JSON.stringify({
  finalists: finalists.slice(0, 6).map(item => ({
    id: item.candidate.genome.id,
    threshold: item.candidate.threshold,
    fitness: item.result.winRate,
    rows: item.result.rows.map(row => ({ opponent: row.opponent, winRate: row.winRate })),
  })),
}));

const champion = finalists[0].candidate;
const final = evaluate(champion, FINAL_GAMES_PER_OPPONENT, 920_000_000);
console.log('NAGISA_V2_RESULT=' + JSON.stringify({
  id: 'nagisa-dedicated-v2',
  sourceId: champion.genome.id,
  threshold: champion.threshold,
  weights: normalizeEvaluationGenome(champion.genome).weights,
  result: {
    ...final,
    rows: final.rows.map(row => ({ opponent: row.opponent, games: row.games, wins: row.wins, losses: row.losses, draws: row.draws, winRate: row.winRate, specials: row.specials, truncated: row.truncated })),
  },
}));
