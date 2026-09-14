import { GameEngine, PHASES, CARD_TYPES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { ACTIONS, RL_LIMITS, tributeMaskToSlots } from '../src/rl-adapter.js';
import { DEFAULT_GENOME, inspectEvaluationActions, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { baselineGenome, chooseBaselineAction } from '../src/baseline-ai.js';
import { NAGISA_GENOME } from '../src/nagisa-policy.js';
import { cloneGenome, mutate, mulberry32, randomGenome } from '../ga/genetics.mjs';

const targetCharacter = process.env.CHARACTER ?? process.argv[2];
if (!['sayaka', 'kyoko', 'homura'].includes(targetCharacter)) {
  throw new Error('CHARACTER must be sayaka, kyoko, or homura');
}

const roster = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura', 'nagisa'];
const opponents = roster.filter(id => id !== targetCharacter);
const POPULATION = 18;
const GENERATIONS = 7;
const TRAIN_GAMES_PER_OPPONENT = 20;
const FINALIST_GAMES_PER_OPPONENT = 400;
const FINAL_GAMES_PER_OPPONENT = 1000;
const MAX_ACTIONS = 900;

function rngFor(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function isMonster(card) {
  return !!card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type);
}

function chooseRanked(adapter, playerIndex, genome, rng, excluded = new Set()) {
  const ranked = inspectEvaluationActions(adapter, playerIndex, genome)
    .filter(item => !excluded.has(item.action));
  if (!ranked.length) return null;
  const best = ranked[0].score;
  const tied = ranked.filter(item => Math.abs(item.score - best) < 1e-9);
  return tied[Math.floor(rng() * tied.length)].action;
}

function recycleValue(card) {
  if (!card) return -Infinity;
  if (card.type === CARD_TYPES.WITCH) return 50 + (card.attack ?? 0) * 7;
  if (card.type === CARD_TYPES.FAMILIAR) return 20 + (card.attack ?? 0) * 5;
  if (card.effect === 'nullifyDamage') return 62;
  if (card.effect === 'draw') return 58;
  if (card.effect === 'boost') return 30 + (card.value ?? 0) * 6;
  return 10;
}

function sayakaSpecialScore(engine, playerIndex) {
  const self = engine.player(playerIndex);
  const opp = engine.player(engine.opponent(playerIndex));
  if (self.graveyard.length < 3) return -Infinity;
  const recover = [...self.graveyard].sort((a, b) => recycleValue(b) - recycleValue(a)).slice(0, 3);
  const recoverScore = recover.reduce((sum, card) => sum + recycleValue(card), 0) / 3;
  const urgency = Math.max(0, 18 - self.deck.length) * 9;
  const attackers = self.field.filter(isMonster);
  if (opp.field.every(card => !isMonster(card)) && attackers.some(card => (card.attack ?? 0) >= opp.deck.length)) return -Infinity;
  const tempoPenalty = attackers.length * 13;
  return recoverScore + urgency - tempoPenalty;
}

function kyokoPlanScore(engine, playerIndex, opponentSlot, witch, plan) {
  const opponent = engine.player(engine.opponent(playerIndex));
  const target = opponent.field[opponentSlot];
  if (!isMonster(target) || witch?.type !== CARD_TYPES.WITCH || !plan) return -Infinity;
  const ownFieldPower = plan.slots.reduce((sum, slot) => sum + (engine.player(playerIndex).field[slot]?.attack ?? 0), 0);
  const ownHandPower = (plan.handIds ?? []).reduce((sum, id) => sum + (engine.player(playerIndex).hand.find(card => card.id === id)?.attack ?? 0), 0);
  const ownCards = plan.slots.length + (plan.handIds?.length ?? 0);
  return (target.attack ?? 0) * 9 + (witch.attack ?? 0) * 8 - (ownFieldPower + ownHandPower) * 4 - ownCards * 8
    + ((witch.attack ?? 0) >= 13 ? 25 : 0) + (target.type === CARD_TYPES.WITCH ? 15 : 0);
}

function bestKyokoPlan(engine, playerIndex, opponentSlot = null) {
  const self = engine.player(playerIndex);
  const targets = opponentSlot === null ? engine.kyokoSpecialTargets(playerIndex) : [opponentSlot];
  let best = null;
  for (const slot of targets) {
    for (const witch of self.hand.filter(card => card.type === CARD_TYPES.WITCH)) {
      for (const plan of engine.validKyokoTributeSets(playerIndex, witch, slot)) {
        const score = kyokoPlanScore(engine, playerIndex, slot, witch, plan);
        if (!best || score > best.score) best = { slot, witch, plan, score };
      }
    }
  }
  return best;
}

function homuraSpecialScore(engine, playerIndex) {
  const self = engine.player(playerIndex);
  const opp = engine.player(engine.opponent(playerIndex));
  const attackers = self.field.filter(card => isMonster(card) && card.attackedTurn !== engine.state.turn);
  if (!attackers.length) return -Infinity;
  const maxAttack = Math.max(...attackers.map(card => card.attack ?? 0));
  const boostValues = self.hand.filter(card => card?.effect === 'boost').map(card => card.value ?? 0);
  const maxBoost = Math.max(0, ...boostValues);
  const oppMonsters = opp.field.filter(isMonster);
  if (!oppMonsters.length && maxAttack >= opp.deck.length) return 10000;
  const bestVisibleSwing = oppMonsters.length
    ? Math.max(...attackers.flatMap(attacker => oppMonsters.map(defender => (attacker.attack ?? 0) + maxBoost - (defender.attack ?? 0))))
    : maxAttack + maxBoost;
  return attackers.length * 22 + maxAttack * 5 + maxBoost * 9 + Math.max(0, bestVisibleSwing) * 7 + opp.hand.length * 5;
}

function specialScore(character, engine, playerIndex) {
  if (character === 'sayaka') return sayakaSpecialScore(engine, playerIndex);
  if (character === 'kyoko') return bestKyokoPlan(engine, playerIndex)?.score ?? -Infinity;
  if (character === 'homura') return homuraSpecialScore(engine, playerIndex);
  return -Infinity;
}

function choosePending(character, adapter, playerIndex, legal) {
  const engine = adapter.engine;
  const d = engine.state.pendingDecision;
  if (!d || d.player !== playerIndex) return null;

  if (character === 'sayaka' && d.type === 'SAYAKA_RECYCLE') {
    const grave = engine.player(playerIndex).graveyard;
    let best = null;
    for (const action of legal) {
      const card = grave[action - ACTIONS.REVIVE_BASE];
      const score = recycleValue(card);
      if (!best || score > best.score) best = { action, score };
    }
    return best?.action ?? legal[0];
  }

  if (character === 'kyoko' && d.type === 'KYOKO_OPPONENT_TRIBUTE') {
    let best = null;
    for (const action of legal) {
      const slot = action - ACTIONS.REVIVE_BASE;
      const plan = bestKyokoPlan(engine, playerIndex, slot);
      if (plan && (!best || plan.score > best.score)) best = { action, score: plan.score };
    }
    return best?.action ?? legal[0];
  }

  if (character === 'kyoko' && d.type === 'KYOKO_WITCH_SUMMON') {
    const self = engine.player(playerIndex);
    let best = null;
    for (const action of legal) {
      const offset = action - ACTIONS.SUMMON_BASE;
      const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
      const slots = tributeMaskToSlots(offset % RL_LIMITS.TRIBUTE_MASKS);
      const witch = self.hand[handIndex];
      const plan = engine.validKyokoTributeSets(playerIndex, witch, d.opponentSlot)
        .find(candidate => candidate.slots.length === slots.length && candidate.slots.every((slot, i) => slot === slots[i]));
      const score = kyokoPlanScore(engine, playerIndex, d.opponentSlot, witch, plan);
      if (!best || score > best.score) best = { action, score };
    }
    return best?.action ?? legal[0];
  }

  return null;
}

function chooseCandidateAction(adapter, playerIndex, candidate, rng) {
  const engine = adapter.engine;
  const legal = adapter.legalActions(playerIndex);
  if (!legal.length) return null;
  const pending = choosePending(targetCharacter, adapter, playerIndex, legal);
  if (pending !== null) return pending;

  if (legal.includes(ACTIONS.SPECIAL)) {
    const score = specialScore(targetCharacter, engine, playerIndex);
    if (score >= candidate.threshold) return ACTIONS.SPECIAL;
    const normal = chooseRanked(adapter, playerIndex, candidate.genome, rng, new Set([ACTIONS.SPECIAL]));
    if (normal !== null) return normal;
  }
  return chooseRanked(adapter, playerIndex, candidate.genome, rng);
}

function playGame(ids, candidateSeat, candidate, seed) {
  const engineRng = rngFor(seed);
  const policyRng = rngFor(seed ^ 0x9e3779b9);
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
      ? chooseCandidateAction(adapter, player, candidate, policyRng)
      : chooseBaselineAction(adapter, player);
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
    const r = playGame([targetCharacter, opponent], 0, candidate, seedBase + i);
    specials += r.specials; truncated += r.truncated ? 1 : 0;
    if (r.winner === 0) wins++; else if (r.winner === 1) losses++; else draws++;
  }
  for (let i = 0; i < games - half; i++) {
    const r = playGame([opponent, targetCharacter], 1, candidate, seedBase + 100000 + i);
    specials += r.specials; truncated += r.truncated ? 1 : 0;
    if (r.winner === 1) wins++; else if (r.winner === 0) losses++; else draws++;
  }
  return { opponent, games, wins, losses, draws, winRate: wins / games, truncated, specials };
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

const searchRng = mulberry32(0x534b5941 ^ targetCharacter.length * 0x9e3779b9);
const thresholdSeeds = targetCharacter === 'homura' ? [80, 120, 160, 200, 240] : [60, 100, 140, 180, 220];
const genomeSeeds = [
  cloneGenome(DEFAULT_GENOME, { id: `${targetCharacter}-seed-default` }),
  cloneGenome(baselineGenome('madoka'), { id: `${targetCharacter}-seed-madoka` }),
  cloneGenome(baselineGenome('mami'), { id: `${targetCharacter}-seed-mami` }),
  cloneGenome(NAGISA_GENOME, { id: `${targetCharacter}-seed-nagisa` }),
];
let population = [];
for (let i = 0; i < genomeSeeds.length; i++) population.push({ genome: genomeSeeds[i], threshold: thresholdSeeds[i % thresholdSeeds.length] });
while (population.length < POPULATION) {
  const parent = genomeSeeds[population.length % genomeSeeds.length];
  const genome = population.length < 12
    ? mutate(cloneGenome(parent, { id: `${targetCharacter}-seed-mut-${population.length}` }), searchRng, { rate: 0.5, sigma: 0.45 })
    : randomGenome(searchRng, { id: `${targetCharacter}-random-${population.length}`, broad: population.length % 2 === 0 });
  population.push({ genome, threshold: thresholdSeeds[population.length % thresholdSeeds.length] });
}

const hall = [];
for (let generation = 0; generation < GENERATIONS; generation++) {
  const scored = population.map((candidate, i) => ({
    candidate,
    result: evaluate(candidate, TRAIN_GAMES_PER_OPPONENT, 100_000_000 + generation * 20_000_000),
  })).sort((a, b) => b.result.winRate - a.result.winRate || a.result.truncated - b.result.truncated);
  const top = scored.slice(0, 5);
  hall.push({
    candidate: { genome: cloneGenome(top[0].candidate.genome, { id: `${top[0].candidate.genome.id}-hall-g${generation}` }), threshold: top[0].candidate.threshold },
    fitness: top[0].result.winRate,
  });
  console.log('DEDICATED_AI_GENERATION=' + JSON.stringify({
    character: targetCharacter,
    generation,
    top: top.map(item => ({ id: item.candidate.genome.id, threshold: item.candidate.threshold, fitness: item.result.winRate })),
  }));

  const elites = top.slice(0, 4).map(item => item.candidate);
  const next = elites.map((candidate, i) => ({
    genome: cloneGenome(candidate.genome, { id: `${targetCharacter}-g${generation + 1}-elite-${i}` }),
    threshold: candidate.threshold,
  }));
  while (next.length < POPULATION - 3) {
    const parent = elites[Math.floor(searchRng() * elites.length)];
    next.push({
      genome: mutate(cloneGenome(parent.genome, { id: `${targetCharacter}-g${generation + 1}-child-${next.length}` }), searchRng, { rate: 0.45, sigma: 0.32 }),
      threshold: Math.max(0, Math.min(320, parent.threshold + (Math.floor(searchRng() * 5) - 2) * 20)),
    });
  }
  while (next.length < POPULATION) {
    next.push({
      genome: randomGenome(searchRng, { id: `${targetCharacter}-g${generation + 1}-immigrant-${next.length}`, broad: true }),
      threshold: thresholdSeeds[Math.floor(searchRng() * thresholdSeeds.length)],
    });
  }
  population = next;
}

const finalPool = [...hall.map(item => item.candidate), ...population.slice(0, 4)];
const finalists = finalPool.map((candidate, i) => ({
  candidate,
  result: evaluate(candidate, FINALIST_GAMES_PER_OPPONENT, 600_000_000 + i * 10_000_000),
})).sort((a, b) => b.result.winRate - a.result.winRate || a.result.truncated - b.result.truncated);

console.log('DEDICATED_AI_FINALISTS=' + JSON.stringify({
  character: targetCharacter,
  finalists: finalists.slice(0, 6).map(item => ({
    id: item.candidate.genome.id,
    threshold: item.candidate.threshold,
    fitness: item.result.winRate,
    rows: item.result.rows.map(row => ({ opponent: row.opponent, winRate: row.winRate })),
  })),
}));

const champion = finalists[0].candidate;
const final = evaluate(champion, FINAL_GAMES_PER_OPPONENT, 900_000_000);
console.log('DEDICATED_AI_RESULT=' + JSON.stringify({
  character: targetCharacter,
  id: `${targetCharacter}-dedicated-v1`,
  sourceId: champion.genome.id,
  threshold: champion.threshold,
  weights: normalizeEvaluationGenome(champion.genome).weights,
  result: {
    ...final,
    rows: final.rows.map(row => ({ opponent: row.opponent, games: row.games, wins: row.wins, losses: row.losses, draws: row.draws, winRate: row.winRate, specials: row.specials, truncated: row.truncated })),
  },
}));
