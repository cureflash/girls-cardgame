import { GameEngine, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { ACTIONS, ATTACK_TARGETS, RL_LIMITS } from '../src/rl-adapter.js';
import { chooseNagisaAction } from '../src/nagisa-ai.js';
import { chooseEvaluationAction, inspectEvaluationActions, DEFAULT_GENOME } from '../src/evaluation-ai.js';
import { baselineGenome } from '../src/baseline-ai.js';
import { cloneGenome, mutate, mulberry32, randomGenome } from '../ga/genetics.mjs';

const opponents = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura'];

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

// Exact activation score used by src/nagisa-ai.js, copied here only for analysis gating.
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
  const opponentTargets = monsterSlots(opponent.field).filter(slot => slot !== attackerSlot);
  const ownTargets = monsterSlots(self.field);
  const scores = [];
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

function chooseEvalFiltered(adapter, playerIndex, genome, policyRng, excluded = new Set()) {
  const ranked = inspectEvaluationActions(adapter, playerIndex, genome).filter(item => !excluded.has(item.action));
  if (!ranked.length) throw new Error('No legal filtered evaluation action.');
  const best = ranked[0].score;
  const tied = ranked.filter(item => Math.abs(item.score - best) < 1e-9);
  return tied[Math.floor(policyRng() * tied.length)].action;
}

function choosePublished(adapter, playerIndex, policyRng) {
  const dedicated = chooseNagisaAction(adapter, playerIndex);
  if (dedicated !== null) return dedicated;
  const charId = adapter.engine.player(playerIndex).character?.id;
  return chooseEvaluationAction(adapter, playerIndex, baselineGenome(charId), policyRng);
}

function chooseNagisaVariant(adapter, playerIndex, genome, policyRng, threshold) {
  const dedicated = chooseNagisaAction(adapter, playerIndex);
  if (threshold === null) {
    if (dedicated !== null) return dedicated;
    return chooseEvaluationAction(adapter, playerIndex, genome, policyRng);
  }

  if (dedicated !== null && dedicated !== ACTIONS.SPECIAL) return dedicated;
  if (dedicated === ACTIONS.SPECIAL && bestSpecialScore(adapter.engine, playerIndex) > threshold) return ACTIONS.SPECIAL;
  return chooseEvalFiltered(adapter, playerIndex, genome, policyRng, new Set([ACTIONS.SPECIAL]));
}

function play(ids, candidateIndex, genome, threshold, seed, maxActions = 1000) {
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
      ? chooseNagisaVariant(adapter, player, genome, policyRng, threshold)
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

function matchup(genome, threshold, opponent, games, seedBase) {
  const half = games / 2;
  let wins = 0, losses = 0, draws = 0, specials = 0, truncated = 0;
  for (let i = 0; i < half; i++) {
    const r = play(['nagisa', opponent], 0, genome, threshold, seedBase + i);
    specials += r.specialUses; truncated += r.truncated ? 1 : 0;
    if (r.winner === 0) wins++; else if (r.winner === 1) losses++; else draws++;
  }
  for (let i = 0; i < half; i++) {
    const r = play([opponent, 'nagisa'], 1, genome, threshold, seedBase + 100000 + i);
    specials += r.specialUses; truncated += r.truncated ? 1 : 0;
    if (r.winner === 1) wins++; else if (r.winner === 0) losses++; else draws++;
  }
  return { opponent, games, wins, losses, draws, winRate: wins / games, specialUses: specials, specialUseRate: specials / games, truncated };
}

function roster(genome, threshold, gamesPerOpponent, seedBase) {
  const rows = opponents.map((opponent, oi) => matchup(genome, threshold, opponent, gamesPerOpponent, seedBase + oi * 1_000_000));
  const games = rows.reduce((s, r) => s + r.games, 0);
  const wins = rows.reduce((s, r) => s + r.wins, 0);
  const losses = rows.reduce((s, r) => s + r.losses, 0);
  const draws = rows.reduce((s, r) => s + r.draws, 0);
  const specialUses = rows.reduce((s, r) => s + r.specialUses, 0);
  const truncated = rows.reduce((s, r) => s + r.truncated, 0);
  return { games, wins, losses, draws, winRate: wins / games, specialUses, specialUseRate: specialUses / games, truncated, rows };
}

function candidateScore(genome, threshold, gamesPerOpponent, seedBase) {
  return roster(genome, threshold, gamesPerOpponent, seedBase).winRate;
}

console.log('DIAG_STAGE=threshold-sweep');
const thresholds = [0, 20, 40, 60, 80, 100, 120, 1e9];
const thresholdSweep = thresholds.map((threshold, i) => ({
  threshold,
  ...roster(DEFAULT_GENOME, threshold, 100, 10_000_000 + i * 10_000_000),
}));
const bestThresholdRow = [...thresholdSweep].sort((a, b) => b.winRate - a.winRate)[0];
const bestThreshold = bestThresholdRow.threshold;
console.log('THRESHOLD_SWEEP=' + JSON.stringify(thresholdSweep.map(({ rows, ...rest }) => rest)));
console.log('BEST_THRESHOLD=' + bestThreshold);

console.log('DIAG_STAGE=genome-search');
const searchRng = mulberry32(0x4e414749);
const initial = [
  cloneGenome(DEFAULT_GENOME, { id: 'nagisa-default' }),
  cloneGenome(baselineGenome('madoka'), { id: 'nagisa-madoka-published' }),
  cloneGenome(baselineGenome('mami'), { id: 'nagisa-mami-published' }),
];
while (initial.length < 48) initial.push(randomGenome(searchRng, { id: `nagisa-random-${initial.length}`, broad: initial.length % 3 === 0 }));
const stage1 = initial.map((genome, i) => ({ genome, score: candidateScore(genome, bestThreshold, 20, 100_000_000) }))
  .sort((a, b) => b.score - a.score);
const top6 = stage1.slice(0, 6);
console.log('GENOME_STAGE1_TOP=' + JSON.stringify(top6.map(x => ({ id: x.genome.id, score: x.score }))));

const stage2Candidates = [...top6.map(x => x.genome)];
for (const parent of top6) {
  for (let i = 0; i < 5; i++) {
    stage2Candidates.push(mutate(cloneGenome(parent, { id: `${parent.id}-m${i}` }), searchRng, { rate: 0.55, sigma: 0.45 }));
  }
}
const stage2 = stage2Candidates.map(genome => ({ genome, score: candidateScore(genome, bestThreshold, 40, 200_000_000) }))
  .sort((a, b) => b.score - a.score);
const top4 = stage2.slice(0, 4);
console.log('GENOME_STAGE2_TOP=' + JSON.stringify(top4.map(x => ({ id: x.genome.id, score: x.score }))));

const stage3 = top4.map(x => ({ genome: x.genome, score: candidateScore(x.genome, bestThreshold, 100, 300_000_000) }))
  .sort((a, b) => b.score - a.score);
const bestGenome = stage3[0].genome;
console.log('GENOME_STAGE3=' + JSON.stringify(stage3.map(x => ({ id: x.genome.id, score: x.score }))));
console.log('BEST_GENOME=' + JSON.stringify({ id: bestGenome.id, weights: bestGenome.weights }));

console.log('DIAG_STAGE=final');
const variants = [
  { id: 'current', genome: DEFAULT_GENOME, threshold: null },
  { id: 'no-special', genome: DEFAULT_GENOME, threshold: 1e9 },
  { id: 'threshold-tuned', genome: DEFAULT_GENOME, threshold: bestThreshold },
  { id: 'genome-and-threshold-tuned', genome: bestGenome, threshold: bestThreshold },
];
const final = variants.map((variant, vi) => ({
  id: variant.id,
  threshold: variant.threshold,
  ...roster(variant.genome, variant.threshold, 1000, 500_000_000 + vi * 20_000_000),
}));
console.log('NAGISA_AI_DIAGNOSIS_RESULT=' + JSON.stringify({ bestThreshold, final }));
