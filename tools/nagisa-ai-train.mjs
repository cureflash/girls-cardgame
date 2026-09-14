import { GameEngine, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { ACTIONS } from '../src/rl-adapter.js';
import { chooseNagisaAction } from '../src/nagisa-ai.js';
import { chooseEvaluationAction, inspectEvaluationActions, DEFAULT_GENOME } from '../src/evaluation-ai.js';
import { baselineGenome } from '../src/baseline-ai.js';
import { cloneGenome, mutate, mulberry32, randomGenome } from '../ga/genetics.mjs';

const OPPONENTS = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura'];
const POPULATION = 18;
const GENERATIONS = 8;
const TRAIN_GAMES_PER_OPPONENT = 60;
const FINALIST_GAMES_PER_OPPONENT = 400;
const FINAL_GAMES_PER_OPPONENT = 1000;
const THRESHOLD_MIN = 40;
const THRESHOLD_MAX = 240;

function rngFor(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function monster(card) {
  return !!card && (card.type === 'familiar' || card.type === 'witch');
}

function monsterSlots(field) {
  return field.map((card, slot) => monster(card) ? slot : null).filter(slot => slot !== null);
}

function targetScore(engine, playerIndex, attackerSlot, targetSide, targetSlot = null) {
  const opponentIndex = engine.opponent(playerIndex);
  const opponent = engine.player(opponentIndex);
  const self = engine.player(playerIndex);
  const attacker = opponent.field[attackerSlot];
  if (!monster(attacker)) return -Infinity;
  const attack = attacker.attack ?? 0;

  if (targetSide === 'direct') {
    const lethal = attack >= opponent.deck.length ? 10000 : 0;
    return lethal + attack * 12;
  }

  const target = targetSide === 'opponent' ? opponent.field[targetSlot] : self.field[targetSlot];
  if (!monster(target)) return -Infinity;
  const defend = target.attack ?? 0;

  if (targetSide === 'opponent') {
    if (attack === defend) return (attack + defend) * 5;
    const removed = attack > defend ? defend : attack;
    const damage = Math.abs(attack - defend);
    const lethal = damage >= opponent.deck.length ? 10000 : 0;
    return lethal + removed * 5 + damage * 12;
  }

  if (attack < defend) {
    const damage = defend - attack;
    const lethal = damage >= opponent.deck.length ? 10000 : 0;
    return lethal + attack * 6 + damage * 12;
  }
  if (attack === defend) return 0;
  return -(defend * 6 + (attack - defend) * 12);
}

function bestTargetScore(engine, playerIndex, attackerSlot) {
  const opponent = engine.player(engine.opponent(playerIndex));
  const self = engine.player(playerIndex);
  const scores = [];
  const opponentTargets = monsterSlots(opponent.field).filter(slot => slot !== attackerSlot);
  const ownTargets = monsterSlots(self.field);
  if (opponentTargets.length === 0) scores.push(targetScore(engine, playerIndex, attackerSlot, 'direct'));
  for (const slot of opponentTargets) scores.push(targetScore(engine, playerIndex, attackerSlot, 'opponent', slot));
  for (const slot of ownTargets) scores.push(targetScore(engine, playerIndex, attackerSlot, 'self', slot));
  return scores.length ? Math.max(...scores) : -Infinity;
}

function bestSpecialScore(engine, playerIndex) {
  const opponent = engine.player(engine.opponent(playerIndex));
  const slots = monsterSlots(opponent.field);
  return slots.length ? Math.max(...slots.map(slot => bestTargetScore(engine, playerIndex, slot))) : -Infinity;
}

function chooseFilteredEvaluation(adapter, playerIndex, genome, policyRng, excluded = new Set()) {
  const ranked = inspectEvaluationActions(adapter, playerIndex, genome).filter(item => !excluded.has(item.action));
  if (!ranked.length) throw new Error('No legal filtered evaluation action.');
  const best = ranked[0].score;
  const tied = ranked.filter(item => Math.abs(item.score - best) < 1e-9);
  return tied[Math.floor(policyRng() * tied.length)].action;
}

function choosePublished(adapter, playerIndex, policyRng) {
  const dedicated = chooseNagisaAction(adapter, playerIndex);
  if (dedicated !== null) return dedicated;
  const characterId = adapter.engine.player(playerIndex).character?.id;
  return chooseEvaluationAction(adapter, playerIndex, baselineGenome(characterId), policyRng);
}

function chooseCandidate(adapter, playerIndex, candidate, policyRng) {
  const dedicated = chooseNagisaAction(adapter, playerIndex);
  if (dedicated !== null && dedicated !== ACTIONS.SPECIAL) return dedicated;
  if (dedicated === ACTIONS.SPECIAL && bestSpecialScore(adapter.engine, playerIndex) > candidate.threshold) return ACTIONS.SPECIAL;
  if (dedicated === ACTIONS.SPECIAL) {
    return chooseFilteredEvaluation(adapter, playerIndex, candidate.genome, policyRng, new Set([ACTIONS.SPECIAL]));
  }
  return chooseEvaluationAction(adapter, playerIndex, candidate.genome, policyRng);
}

function play(ids, candidateIndex, candidate, seed, maxActions = 1000) {
  const engineRng = rngFor(seed);
  const policyRng = rngFor(seed ^ 0x9e3779b9);
  const engine = new GameEngine({
    players: ids.map((id, i) => ({ id: `p${i}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng: engineRng,
  });
  const adapter = new CharacterAdapter(engine);
  let steps = 0;
  let specialUses = 0;

  while (engine.state.phase !== PHASES.GAME_OVER && steps < maxActions) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) throw new Error(`No legal actions at step ${steps}: ${ids.join(' vs ')}`);
    const action = player === candidateIndex
      ? chooseCandidate(adapter, player, candidate, policyRng)
      : choosePublished(adapter, player, policyRng);
    if (action === null || !legal.includes(action)) throw new Error(`Illegal action ${action} at step ${steps}: ${ids.join(' vs ')}`);
    if (player === candidateIndex && action === ACTIONS.SPECIAL) specialUses++;
    adapter.applyAction(action, player);
    steps++;
  }

  return {
    winner: engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null,
    specialUses,
    truncated: engine.state.phase !== PHASES.GAME_OVER,
  };
}

function matchup(candidate, opponent, games, seedBase) {
  const half = games / 2;
  let wins = 0, losses = 0, draws = 0, specialUses = 0, truncated = 0;
  for (let i = 0; i < half; i++) {
    const result = play(['nagisa', opponent], 0, candidate, seedBase + i);
    specialUses += result.specialUses;
    truncated += result.truncated ? 1 : 0;
    if (result.winner === 0) wins++; else if (result.winner === 1) losses++; else draws++;
  }
  for (let i = 0; i < half; i++) {
    const result = play([opponent, 'nagisa'], 1, candidate, seedBase + 100000 + i);
    specialUses += result.specialUses;
    truncated += result.truncated ? 1 : 0;
    if (result.winner === 1) wins++; else if (result.winner === 0) losses++; else draws++;
  }
  return { opponent, games, wins, losses, draws, winRate: wins / games, specialUses, truncated };
}

function roster(candidate, gamesPerOpponent, seedBase) {
  const rows = OPPONENTS.map((opponent, index) => matchup(candidate, opponent, gamesPerOpponent, seedBase + index * 1_000_000));
  const games = rows.reduce((sum, row) => sum + row.games, 0);
  const wins = rows.reduce((sum, row) => sum + row.wins, 0);
  const losses = rows.reduce((sum, row) => sum + row.losses, 0);
  const draws = rows.reduce((sum, row) => sum + row.draws, 0);
  const specialUses = rows.reduce((sum, row) => sum + row.specialUses, 0);
  const truncated = rows.reduce((sum, row) => sum + row.truncated, 0);
  return { games, wins, losses, draws, winRate: wins / games, specialUses, specialUseRate: specialUses / games, truncated, rows };
}

function cloneCandidate(candidate, id) {
  return {
    id,
    threshold: candidate.threshold,
    genome: cloneGenome(candidate.genome, { id }),
  };
}

function clampThreshold(value) {
  return Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, Math.round(value / 20) * 20));
}

function mutateCandidate(parent, rng, id, generation) {
  const thresholdShift = (Math.floor(rng() * 5) - 2) * 20;
  return {
    id,
    threshold: clampThreshold(parent.threshold + thresholdShift),
    genome: mutate(cloneGenome(parent.genome, { id, generation, parents: [parent.id] }), rng, { rate: 0.48, sigma: 0.32 }),
  };
}

function randomCandidate(rng, id, generation) {
  const thresholds = [80, 100, 120, 140, 160, 180];
  return {
    id,
    threshold: thresholds[Math.floor(rng() * thresholds.length)],
    genome: randomGenome(rng, { id, generation, broad: true }),
  };
}

const searchRng = mulberry32(0x4e414749);
const mami = baselineGenome('mami');
const madoka = baselineGenome('madoka');
let population = [
  { id: 'nagisa-seed-mami', threshold: 120, genome: cloneGenome(mami, { id: 'nagisa-seed-mami' }) },
  { id: 'nagisa-seed-madoka', threshold: 120, genome: cloneGenome(madoka, { id: 'nagisa-seed-madoka' }) },
  { id: 'nagisa-seed-default', threshold: 120, genome: cloneGenome(DEFAULT_GENOME, { id: 'nagisa-seed-default' }) },
];
while (population.length < POPULATION) {
  if (population.length < 12) population.push(mutateCandidate(population[0], searchRng, `nagisa-seed-mami-m${population.length}`, 0));
  else population.push(randomCandidate(searchRng, `nagisa-random-${population.length}`, 0));
}

let hall = [];
for (let generation = 0; generation < GENERATIONS; generation++) {
  const scored = population.map((candidate, index) => {
    const result = roster(candidate, TRAIN_GAMES_PER_OPPONENT, 100_000_000 + generation * 20_000_000 + index * 500_000);
    return { candidate, result, fitness: result.winRate };
  }).sort((a, b) => b.fitness - a.fitness);

  const top = scored.slice(0, 6);
  console.log('NAGISA_TRAIN_GENERATION=' + JSON.stringify({
    generation,
    top: top.map(entry => ({ id: entry.candidate.id, threshold: entry.candidate.threshold, fitness: entry.fitness })),
  }));
  hall.push(...top.slice(0, 2).map(entry => cloneCandidate(entry.candidate, `${entry.candidate.id}-hall-g${generation}`)));

  const next = top.slice(0, 4).map((entry, index) => cloneCandidate(entry.candidate, `nagisa-g${generation + 1}-elite-${index}`));
  let childIndex = 0;
  while (next.length < POPULATION - 2) {
    const parent = top[Math.floor(searchRng() * top.length)].candidate;
    next.push(mutateCandidate(parent, searchRng, `nagisa-g${generation + 1}-child-${childIndex++}`, generation + 1));
  }
  while (next.length < POPULATION) next.push(randomCandidate(searchRng, `nagisa-g${generation + 1}-random-${next.length}`, generation + 1));
  population = next;
}

const finalists = [...population, ...hall.slice(-8)];
const finalistScores = finalists.map((candidate, index) => {
  const result = roster(candidate, FINALIST_GAMES_PER_OPPONENT, 500_000_000 + index * 10_000_000);
  return { candidate, result, fitness: result.winRate };
}).sort((a, b) => b.fitness - a.fitness);

console.log('NAGISA_TRAIN_FINALISTS=' + JSON.stringify(finalistScores.slice(0, 6).map(entry => ({
  id: entry.candidate.id,
  threshold: entry.candidate.threshold,
  fitness: entry.fitness,
  rows: entry.result.rows.map(row => ({ opponent: row.opponent, winRate: row.winRate })),
}))));

const champion = finalistScores[0].candidate;
const finalResult = roster(champion, FINAL_GAMES_PER_OPPONENT, 900_000_000);
console.log('NAGISA_TRAIN_RESULT=' + JSON.stringify({
  id: 'nagisa-dedicated-v1',
  sourceId: champion.id,
  threshold: champion.threshold,
  weights: champion.genome.weights,
  result: finalResult,
}));
