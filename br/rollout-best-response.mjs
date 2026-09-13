import { PHASES, CARD_TYPES } from '../src/game-engine.js';
import {
  ACTIONS,
  ATTACK_TARGETS,
  RL_LIMITS,
  tributeMaskToSlots,
} from '../src/rl-adapter.js';
import { createDeck } from '../src/card-data.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';
import { cloneAdapter, createMatch, seededRng } from '../cfr/solver.mjs';

export const BEST_RESPONSE_FORMAT = 'girls-cardgame-rollout-best-response-v1';

function shuffle(cards, rng) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function removeKnown(template, knownCards) {
  const remaining = [...template];
  for (const known of knownCards.filter(Boolean)) {
    let index = remaining.findIndex(card => card.id === known.id);
    if (index < 0) index = remaining.findIndex(card => card.code === known.code);
    if (index < 0) throw new Error(`Cannot reconcile known card ${known.id ?? known.code}.`);
    remaining.splice(index, 1);
  }
  return remaining;
}

function chainCardsFor(adapter, playerIndex) {
  return adapter.engine.state.chain
    .filter(item => item.player === playerIndex)
    .map(item => item.card)
    .filter(Boolean);
}

/**
 * Randomize only information that the perspective player cannot know:
 * - own future deck order
 * - opponent hidden hand identities
 * - opponent future deck order
 * Public field/grave/chain cards and the perspective player's hand stay fixed.
 */
export function determinizeForPlayer(adapter, perspective, rng = Math.random) {
  const sampled = cloneAdapter(adapter);
  const self = sampled.engine.player(perspective);
  const opponentIndex = sampled.engine.opponent(perspective);
  const opp = sampled.engine.player(opponentIndex);

  const selfTemplate = createDeck(self.character.id);
  const selfKnown = [
    ...self.hand,
    ...self.field.filter(Boolean),
    ...self.graveyard,
    ...chainCardsFor(sampled, perspective),
  ];
  const selfUnseen = removeKnown(selfTemplate, selfKnown);
  if (selfUnseen.length !== self.deck.length) {
    throw new Error(`Self unseen-card mismatch: expected ${self.deck.length}, got ${selfUnseen.length}.`);
  }
  self.deck = shuffle(selfUnseen, rng).map(card => ({ ...card }));

  const oppTemplate = createDeck(opp.character.id);
  const oppPublic = [
    ...opp.field.filter(Boolean),
    ...opp.graveyard,
    ...chainCardsFor(sampled, opponentIndex),
  ];
  const oppUnseen = shuffle(removeKnown(oppTemplate, oppPublic), rng);
  const hiddenCount = opp.hand.length + opp.deck.length;
  if (oppUnseen.length !== hiddenCount) {
    throw new Error(`Opponent unseen-card mismatch: expected ${hiddenCount}, got ${oppUnseen.length}.`);
  }
  const handCount = opp.hand.length;
  opp.hand = oppUnseen.slice(0, handCount).map(card => ({ ...card }));
  opp.deck = oppUnseen.slice(handCount).map(card => ({ ...card }));

  return sampled;
}

function decodeAction(adapter, action, playerIndex) {
  const p = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  if (action === ACTIONS.PASS) return { kind: 'pass', label: 'pass' };
  if (action === ACTIONS.END_TURN) return { kind: 'end-turn', label: 'end-turn' };
  if (action === ACTIONS.ENTER_BATTLE) return { kind: 'enter-battle', label: 'enter-battle' };
  if (action === ACTIONS.CONTINUE_BATTLE) return { kind: 'continue-battle', label: 'continue-battle' };
  if (action === ACTIONS.SPECIAL) return { kind: 'special', label: `special:${p.character?.id ?? 'unknown'}` };

  if (action >= ACTIONS.SUMMON_BASE && action < ACTIONS.ATTACK_BASE) {
    const offset = action - ACTIONS.SUMMON_BASE;
    const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
    const mask = offset % RL_LIMITS.TRIBUTE_MASKS;
    const card = p.hand[handIndex];
    const slots = tributeMaskToSlots(mask);
    let cost = 0;
    if (card?.type === CARD_TYPES.WITCH) {
      const plan = adapter.engine.validTributeSets(playerIndex, card).find(candidate => {
        const a = [...candidate.slots].sort((x, y) => x - y);
        const b = [...slots].sort((x, y) => x - y);
        return a.length === b.length && a.every((slot, i) => slot === b[i]);
      });
      if (plan) {
        const fieldPower = plan.slots.reduce((sum, slot) => sum + (p.field[slot]?.attack ?? 0), 0);
        cost = Math.max(0, plan.total - (card.attack ?? 0)) * 1000 + fieldPower * 20 + plan.slots.length * 10 + plan.handIds.length;
      }
    }
    return {
      kind: 'summon',
      type: card?.type,
      attack: card?.attack ?? 0,
      cost,
      label: card?.type === CARD_TYPES.WITCH ? `summon-witch:${card.attack}` : `summon-familiar:${card?.attack ?? 0}`,
    };
  }

  if (action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE) {
    const offset = action - ACTIONS.ATTACK_BASE;
    const attackerSlot = Math.floor(offset / ATTACK_TARGETS);
    const target = offset % ATTACK_TARGETS;
    const attacker = p.field[attackerSlot]?.attack ?? 0;
    if (target === RL_LIMITS.FIELD_SLOTS) return { kind: 'attack-direct', attacker, label: `attack-direct:${attacker}` };
    const defender = opp.field[target]?.attack ?? 0;
    return { kind: 'attack-battle', attacker, defender, label: `attack:${attacker}->${defender}` };
  }

  if (action >= ACTIONS.MAIN_MAGIC_BASE && action < ACTIONS.CHAIN_BASE) {
    const card = p.hand[action - ACTIONS.MAIN_MAGIC_BASE];
    return { kind: 'main-magic', value: card?.value ?? 0, label: `main-magic:${card?.effect ?? 'unknown'}:${card?.value ?? 0}` };
  }
  if (action >= ACTIONS.CHAIN_BASE && action < ACTIONS.REVIVE_BASE) {
    const card = p.hand[action - ACTIONS.CHAIN_BASE];
    if (card?.effect === 'nullifyDamage') return { kind: 'shield', value: 0, label: 'shield' };
    return { kind: 'boost', value: card?.value ?? 0, label: `boost:${card?.value ?? 0}` };
  }
  if (action >= ACTIONS.REVIVE_BASE && action < ACTIONS.COUNT) {
    const card = p.graveyard[action - ACTIONS.REVIVE_BASE];
    return { kind: 'revive', attack: card?.attack ?? 0, label: `revive:${card?.attack ?? 0}` };
  }
  return { kind: 'unknown', label: `action:${action}` };
}

function pick(entries, compare) {
  if (!entries.length) return null;
  return [...entries].sort(compare)[0];
}

/** Reduce mechanically duplicated concrete actions while retaining strategically distinct choices. */
export function candidateActions(adapter, playerIndex = adapter.currentPlayer()) {
  const legal = adapter.legalActions(playerIndex);
  if (legal.length <= 1) return legal.map(action => ({ action, label: decodeAction(adapter, action, playerIndex).label }));
  const decoded = legal.map(action => ({ action, ...decodeAction(adapter, action, playerIndex) }));
  const chosen = new Map();
  const add = entry => { if (entry) chosen.set(entry.action, { action: entry.action, label: entry.label }); };

  for (const kind of ['pass', 'end-turn', 'enter-battle', 'continue-battle', 'special', 'shield']) {
    add(decoded.find(entry => entry.kind === kind));
  }
  for (const value of [2, 3, 5]) add(decoded.find(entry => entry.kind === 'boost' && entry.value === value));
  for (const entry of decoded.filter(entry => entry.kind === 'main-magic')) add(entry);

  const familiars = decoded.filter(entry => entry.kind === 'summon' && entry.type === CARD_TYPES.FAMILIAR);
  for (const attack of [...new Set(familiars.map(entry => entry.attack))]) add(familiars.find(entry => entry.attack === attack));

  const witches = decoded.filter(entry => entry.kind === 'summon' && entry.type === CARD_TYPES.WITCH);
  for (const attack of [...new Set(witches.map(entry => entry.attack))]) {
    add(pick(witches.filter(entry => entry.attack === attack), (a, b) => a.cost - b.cost || a.action - b.action));
  }

  const direct = decoded.filter(entry => entry.kind === 'attack-direct');
  for (const attack of [...new Set(direct.map(entry => entry.attacker))]) add(direct.find(entry => entry.attacker === attack));

  const battles = decoded.filter(entry => entry.kind === 'attack-battle');
  const battleGroups = new Map();
  for (const entry of battles) {
    const key = `${entry.attacker}->${entry.defender}`;
    if (!battleGroups.has(key)) battleGroups.set(key, entry);
  }
  for (const entry of battleGroups.values()) add(entry);

  const revives = decoded.filter(entry => entry.kind === 'revive');
  for (const attack of [...new Set(revives.map(entry => entry.attack))]) add(revives.find(entry => entry.attack === attack));

  return [...chosen.values()].sort((a, b) => a.action - b.action);
}

function terminalScore(adapter, perspective) {
  if (adapter.engine.state.phase !== PHASES.GAME_OVER) return 0.5;
  const winner = adapter.engine.state.winner;
  if (winner === null || winner === undefined) return 0.5;
  return winner === perspective ? 1 : 0;
}

function rolloutBaseline(adapter, perspective, maxActions) {
  let steps = 0;
  for (; steps < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; steps++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    let action = legal.length === 1 ? legal[0] : chooseBaselineAction(adapter, player);
    if (!legal.includes(action)) action = legal[0];
    adapter.applyAction(action, player);
  }
  return { score: terminalScore(adapter, perspective), terminated: adapter.engine.state.phase === PHASES.GAME_OVER, steps };
}

export function evaluateDecision(adapter, perspective, {
  samples = 12,
  seed = 1,
  maxActions = 220,
} = {}) {
  const candidates = candidateActions(adapter, perspective);
  if (!candidates.length) throw new Error('No candidate actions.');
  if (candidates.length === 1) {
    return { action: candidates[0].action, label: candidates[0].label, candidates: [{ ...candidates[0], score: 0.5, wins: 0, losses: 0, draws: samples }], forced: true };
  }

  const accum = new Map(candidates.map(candidate => [candidate.action, { ...candidate, total: 0, wins: 0, losses: 0, draws: 0, cutoffs: 0 }]));
  for (let sample = 0; sample < samples; sample++) {
    const sampleRng = seededRng((seed + sample * 2654435761) >>> 0);
    const world = determinizeForPlayer(adapter, perspective, sampleRng);
    for (const candidate of candidates) {
      const child = cloneAdapter(world);
      const legal = child.legalActions(perspective);
      if (!legal.includes(candidate.action)) throw new Error(`Candidate ${candidate.action} became illegal after determinization.`);
      child.applyAction(candidate.action, perspective);
      const result = rolloutBaseline(child, perspective, maxActions);
      const row = accum.get(candidate.action);
      row.total += result.score;
      if (!result.terminated) row.cutoffs += 1;
      if (result.score === 1) row.wins += 1;
      else if (result.score === 0) row.losses += 1;
      else row.draws += 1;
    }
  }

  const rows = [...accum.values()].map(row => ({
    action: row.action,
    label: row.label,
    score: row.total / samples,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    cutoffs: row.cutoffs,
  })).sort((a, b) => b.score - a.score || a.action - b.action);

  const baseline = chooseBaselineAction(adapter, perspective);
  const baselineRow = rows.find(row => row.action === baseline) ?? null;
  return {
    action: rows[0].action,
    label: rows[0].label,
    bestScore: rows[0].score,
    baselineAction: baseline,
    baselineScore: baselineRow?.score ?? null,
    estimatedGain: baselineRow ? rows[0].score - baselineRow.score : null,
    candidates: rows,
    forced: false,
  };
}

export function playBestResponseGame({
  character = 'madoka',
  seed = 1,
  samples = 8,
  maxActions = 220,
} = {}) {
  const swapped = character === 'madoka' ? Boolean(seed & 1) : !Boolean(seed & 1);
  const adapter = createMatch(seed, swapped);
  const perspective = adapter.engine.state.players.findIndex(player => player.character?.id === character);
  const decisionStats = [];
  const actionCounts = {};
  let plannerDecisions = 0;
  let cutoffs = 0;

  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    let action;
    if (player !== perspective) {
      action = legal.length === 1 ? legal[0] : chooseBaselineAction(adapter, player);
      if (!legal.includes(action)) action = legal[0];
    } else if (legal.length === 1) {
      action = legal[0];
    } else {
      const decision = evaluateDecision(adapter, perspective, {
        samples,
        seed: (seed * 1000003 + step * 9176 + plannerDecisions * 37) >>> 0,
        maxActions,
      });
      action = decision.action;
      plannerDecisions += 1;
      const best = decision.candidates[0];
      cutoffs += best.cutoffs;
      actionCounts[decision.label] = (actionCounts[decision.label] ?? 0) + 1;
      decisionStats.push({
        turn: adapter.engine.state.turn,
        phase: adapter.engine.state.phase,
        label: decision.label,
        score: decision.bestScore,
        baselineScore: decision.baselineScore,
        estimatedGain: decision.estimatedGain,
        runnerUp: decision.candidates[1] ? { label: decision.candidates[1].label, score: decision.candidates[1].score } : null,
      });
    }
    adapter.applyAction(action, player);
  }

  const winner = adapter.engine.state.winner;
  return {
    character,
    seed,
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
    winnerCharacter: winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id,
    plannerDecisions,
    rolloutCutoffs: cutoffs,
    actionCounts,
    decisionStats,
  };
}

export function evaluateBestResponse({
  character = 'madoka',
  games = 40,
  samples = 8,
  seed = 910001,
  maxActions = 220,
} = {}) {
  const summary = {
    format: BEST_RESPONSE_FORMAT,
    character,
    games,
    samples,
    wins: 0,
    losses: 0,
    draws: 0,
    terminated: 0,
    plannerDecisions: 0,
    rolloutCutoffs: 0,
    actionCounts: {},
    meanEstimatedGain: 0,
    positiveGainDecisions: 0,
    measuredGainDecisions: 0,
  };
  let gainTotal = 0;

  for (let game = 0; game < games; game++) {
    const result = playBestResponseGame({ character, seed: seed + game * 65537, samples, maxActions });
    if (result.terminated) summary.terminated += 1;
    if (result.winnerCharacter === character) summary.wins += 1;
    else if (result.winnerCharacter === null) summary.draws += 1;
    else summary.losses += 1;
    summary.plannerDecisions += result.plannerDecisions;
    summary.rolloutCutoffs += result.rolloutCutoffs;
    for (const [key, value] of Object.entries(result.actionCounts)) summary.actionCounts[key] = (summary.actionCounts[key] ?? 0) + value;
    for (const decision of result.decisionStats) {
      if (decision.estimatedGain === null) continue;
      summary.measuredGainDecisions += 1;
      gainTotal += decision.estimatedGain;
      if (decision.estimatedGain > 0) summary.positiveGainDecisions += 1;
    }
  }
  summary.winRate = summary.wins / games;
  summary.meanEstimatedGain = summary.measuredGainDecisions ? gainTotal / summary.measuredGainDecisions : 0;
  return summary;
}

export function evaluateBaselineControl({
  character = 'madoka',
  games = 40,
  seed = 910001,
  maxActions = 220,
} = {}) {
  const summary = { character, games, wins: 0, losses: 0, draws: 0, terminated: 0 };
  for (let game = 0; game < games; game++) {
    const gameSeed = seed + game * 65537;
    const swapped = character === 'madoka' ? Boolean(gameSeed & 1) : !Boolean(gameSeed & 1);
    const adapter = createMatch(gameSeed, swapped);
    for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
      const player = adapter.currentPlayer();
      const legal = adapter.legalActions(player);
      if (!legal.length) break;
      let action = legal.length === 1 ? legal[0] : chooseBaselineAction(adapter, player);
      if (!legal.includes(action)) action = legal[0];
      adapter.applyAction(action, player);
    }
    const winner = adapter.engine.state.winner;
    if (adapter.engine.state.phase === PHASES.GAME_OVER) summary.terminated += 1;
    const winnerCharacter = winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id;
    if (winnerCharacter === character) summary.wins += 1;
    else if (winnerCharacter === null) summary.draws += 1;
    else summary.losses += 1;
  }
  summary.winRate = summary.wins / games;
  return summary;
}
