import { CARD_TYPES, PHASES } from './character-engine.js';
import { ACTIONS, ATTACK_TARGETS, RL_LIMITS } from './rl-adapter.js';
import { inspectEvaluationActions } from './evaluation-ai.js';
import { HOMURA_GENOME } from './remaining-policies.js';

const isMonster = card => !!card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type);
const effectiveBoostValue = card => card?.effect === 'boost' ? (card.value ?? 0) + 2 : 0;

function chooseRanked(adapter, playerIndex, genome, rng, excluded = new Set()) {
  const ranked = inspectEvaluationActions(adapter, playerIndex, genome)
    .filter(item => !excluded.has(item.action));
  if (!ranked.length) return null;
  const best = ranked[0].score;
  const tied = ranked.filter(item => Math.abs(item.score - best) < 1e-9);
  return tied[Math.floor(rng() * tied.length)].action;
}

function cloneAdapterForSearch(adapter) {
  const engine = Object.create(Object.getPrototypeOf(adapter.engine));
  for (const [key, value] of Object.entries(adapter.engine)) {
    engine[key] = key === 'state' ? structuredClone(value) : value;
  }
  return new adapter.constructor(engine);
}

function homuraSpecialActive(engine, playerIndex) {
  return engine.player(playerIndex).character?.id === 'homura'
    && engine.state.homuraChainLockTurn === engine.state.turn
    && engine.state.homuraChainLockPlayer === engine.opponent(playerIndex);
}

function homuraSearchKey(adapter, playerIndex) {
  const engine = adapter.engine;
  const state = engine.state;
  const self = engine.player(playerIndex);
  const opp = engine.player(engine.opponent(playerIndex));
  const summarizeCard = card => card ? [card.id, card.attackedTurn ?? null] : null;
  return JSON.stringify([
    state.turn,
    state.activePlayer,
    state.priorityPlayer,
    state.phase,
    state.pendingDecision,
    state.battle,
    state.chain.map(item => [item.player, item.card?.id]),
    state.chainPassCount,
    state.battlePhaseEnded,
    state.homuraChainLockTurn,
    state.homuraChainLockPlayer,
    self.deck.length,
    self.hand.map(card => card.id),
    self.field.map(summarizeCard),
    self.graveyard.map(card => card.id),
    self.specialUsed,
    opp.deck.length,
    opp.hand.map(card => card.id),
    opp.field.map(summarizeCard),
    opp.graveyard.map(card => card.id),
    state.winner,
  ]);
}

function chainCardForAction(adapter, playerIndex, action) {
  if (action < ACTIONS.CHAIN_BASE || action >= ACTIONS.REVIVE_BASE) return null;
  return adapter.engine.player(playerIndex).hand[action - ACTIONS.CHAIN_BASE] ?? null;
}

function homuraOtkUpperBound(engine, playerIndex) {
  const self = engine.player(playerIndex);
  const opp = engine.player(engine.opponent(playerIndex));
  const fieldPower = self.field
    .filter(card => isMonster(card) && card.attackedTurn !== engine.state.turn)
    .reduce((sum, card) => sum + (card.attack ?? 0), 0);
  const boostPower = self.hand
    .filter(card => card?.effect === 'boost')
    .reduce((sum, card) => sum + effectiveBoostValue(card), 0);
  return fieldPower + boostPower >= opp.deck.length;
}

function homuraOtkSearchActions(adapter, playerIndex) {
  const engine = adapter.engine;
  const legal = adapter.legalActions(playerIndex);
  const pending = engine.state.pendingDecision;

  if (pending?.type === 'CHAIN_RESPONSE') {
    const usedBoostIds = engine.state.chain
      .filter(item => item.player === playerIndex && item.card?.effect === 'boost')
      .map(item => item.card.id)
      .sort();
    const lastBoostId = usedBoostIds.at(-1) ?? null;
    return legal
      .filter(action => {
        if (action === ACTIONS.PASS) return true;
        const card = chainCardForAction(adapter, playerIndex, action);
        if (card?.effect !== 'boost') return false;
        return lastBoostId === null || card.id > lastBoostId;
      })
      .sort((a, b) => {
        if (a === ACTIONS.PASS) return -1;
        if (b === ACTIONS.PASS) return 1;
        return effectiveBoostValue(chainCardForAction(adapter, playerIndex, a))
          - effectiveBoostValue(chainCardForAction(adapter, playerIndex, b));
      });
  }

  if (engine.state.phase === PHASES.BATTLE_START) {
    return legal.includes(ACTIONS.CONTINUE_BATTLE) ? [ACTIONS.CONTINUE_BATTLE] : [];
  }

  if (engine.state.phase === PHASES.BATTLE) {
    return legal.filter(action => action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE);
  }

  return [];
}

function searchHomuraOtkContinuation(adapter, playerIndex, startTurn, depth, dead) {
  const engine = adapter.engine;
  if (engine.state.phase === PHASES.GAME_OVER) {
    return engine.state.winner === playerIndex ? [] : null;
  }
  if (depth <= 0 || engine.state.turn !== startTurn || engine.state.activePlayer !== playerIndex) return null;
  if (adapter.currentPlayer() !== playerIndex) return null;

  const key = homuraSearchKey(adapter, playerIndex);
  if (dead.has(key)) return null;

  for (const action of homuraOtkSearchActions(adapter, playerIndex)) {
    const next = cloneAdapterForSearch(adapter);
    try {
      next.applyAction(action, playerIndex);
    } catch {
      continue;
    }
    const tail = searchHomuraOtkContinuation(next, playerIndex, startTurn, depth - 1, dead);
    if (tail) return [action, ...tail];
  }

  dead.add(key);
  return null;
}

export function findHomuraOtkLine(adapter, playerIndex = adapter.currentPlayer()) {
  const engine = adapter.engine;
  if (engine.player(playerIndex).character?.id !== 'homura') return null;
  if (!adapter.legalActions(playerIndex).includes(ACTIONS.SPECIAL)) return null;
  if (!homuraOtkUpperBound(engine, playerIndex)) return null;

  const next = cloneAdapterForSearch(adapter);
  try {
    next.applyAction(ACTIONS.SPECIAL, playerIndex);
  } catch {
    return null;
  }
  const tail = searchHomuraOtkContinuation(next, playerIndex, engine.state.turn, 48, new Set());
  return tail ? [ACTIONS.SPECIAL, ...tail] : null;
}

function findHomuraActiveOtkContinuation(adapter, playerIndex) {
  if (!homuraSpecialActive(adapter.engine, playerIndex)) return null;
  return searchHomuraOtkContinuation(adapter, playerIndex, adapter.engine.state.turn, 48, new Set());
}

export function homuraSetupPotential(engine, playerIndex) {
  const self = engine.player(playerIndex);
  const opp = engine.player(engine.opponent(playerIndex));
  const field = self.field.filter(isMonster);
  const fieldPower = field.reduce((sum, card) => sum + (card.attack ?? 0), 0);
  const boosts = self.hand.filter(card => card?.effect === 'boost');
  const boostPower = boosts.reduce((sum, card) => sum + effectiveBoostValue(card), 0);
  const reserveMonster = self.hand.filter(isMonster).sort((a, b) => (b.attack ?? 0) - (a.attack ?? 0))[0] ?? null;
  const oppMonsters = opp.field.filter(isMonster);
  const oppPower = oppMonsters.reduce((sum, card) => sum + (card.attack ?? 0), 0);
  const burst = fieldPower + boostPower;
  const deckPressure = Math.max(0, 30 - opp.deck.length);

  return field.length * 100
    + fieldPower * 16
    + boosts.length * 45
    + boostPower * 22
    + (reserveMonster?.attack ?? 0) * 4
    + Math.max(-30, burst - opp.deck.length) * 10
    + deckPressure * 10
    - oppMonsters.length * 30
    - oppPower * 2.5
    + self.deck.length * 0.5
    - (self.specialUsed ? 10000 : 0);
}

function projectedBattleValues(engine) {
  const battle = engine.state.battle;
  if (!battle) return null;
  let attacker = battle.attackerBase + battle.attackerBonus;
  let defender = battle.defenderBase + battle.defenderBonus;
  for (const item of engine.state.chain) {
    if (item.card?.effect !== 'boost') continue;
    const value = engine.player(item.player).character?.id === 'homura'
      ? effectiveBoostValue(item.card)
      : (item.card.value ?? 0);
    if (item.player === battle.attackerPlayer) attacker += value;
    else if (item.player === battle.defenderPlayer) defender += value;
  }
  return { attacker, defender };
}

function chooseHomuraSetupChain(adapter, playerIndex, legal) {
  const engine = adapter.engine;
  const battle = engine.state.battle;
  if (!battle) return legal.includes(ACTIONS.PASS) ? ACTIONS.PASS : legal[0];
  const values = projectedBattleValues(engine);
  const selfIsAttacker = battle.attackerPlayer === playerIndex;
  const selfIsDefender = battle.defenderPlayer === playerIndex;
  const wouldLoseMonster = selfIsAttacker
    ? values.attacker <= values.defender
    : selfIsDefender ? values.defender <= values.attacker : false;

  if (wouldLoseMonster) {
    const shield = legal.find(action => chainCardForAction(adapter, playerIndex, action)?.effect === 'nullifyDamage');
    if (shield !== undefined) return shield;
  }
  if (legal.includes(ACTIONS.PASS)) return ACTIONS.PASS;
  return legal[0];
}

function homuraAttackScore(engine, playerIndex, action) {
  const self = engine.player(playerIndex);
  const opp = engine.player(engine.opponent(playerIndex));
  const offset = action - ACTIONS.ATTACK_BASE;
  const attackerSlot = Math.floor(offset / ATTACK_TARGETS);
  const targetCode = offset % ATTACK_TARGETS;
  const attacker = self.field[attackerSlot];
  if (!isMonster(attacker)) return -Infinity;

  if (targetCode === RL_LIMITS.FIELD_SLOTS) {
    const raw = attacker.attack ?? 0;
    const damage = opp.character?.id === 'madoka' ? Math.max(0, raw - 1) : raw;
    if (damage >= opp.deck.length) return -Infinity;
    return damage * 42 + Math.max(0, 12 - opp.deck.length) * 8;
  }

  const defender = opp.field[targetCode];
  if (!isMonster(defender)) return -Infinity;
  const attack = attacker.attack ?? 0;
  const defend = defender.attack ?? 0;
  if (attack > defend) {
    const raw = attack - defend;
    const damage = opp.character?.id === 'madoka' ? Math.max(0, raw - 1) : raw;
    if (damage >= opp.deck.length) return -Infinity;
    return defend * 30 + damage * 22 + (defender.type === CARD_TYPES.WITCH ? 28 : 0);
  }
  if (attack === defend) return defend * 8 - attack * 18 - 80;
  return -attack * 28 - (defend - attack) * 16 - 120;
}

function chooseHomuraSetupBattle(adapter, playerIndex, legal) {
  const attacks = legal.filter(action => action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE);
  let best = null;
  for (const action of attacks) {
    const score = homuraAttackScore(adapter.engine, playerIndex, action);
    if (!best || score > best.score) best = { action, score };
  }
  if (best && best.score > 0) return best.action;
  if (legal.includes(ACTIONS.END_TURN)) return ACTIONS.END_TURN;
  return best?.action ?? legal[0];
}

function chooseHomuraSetupMain(adapter, playerIndex, genome, rng, legal) {
  const evaluation = new Map(inspectEvaluationActions(adapter, playerIndex, genome).map(item => [item.action, item.score]));
  let best = null;
  for (const action of legal) {
    if (action === ACTIONS.SPECIAL) continue;
    const next = cloneAdapterForSearch(adapter);
    try {
      next.applyAction(action, playerIndex);
    } catch {
      continue;
    }
    let score = homuraSetupPotential(next.engine, playerIndex) + (evaluation.get(action) ?? 0) * 0.05;
    if (action >= ACTIONS.SUMMON_BASE && action < ACTIONS.ATTACK_BASE) score += 45;
    if (action === ACTIONS.ENTER_BATTLE && adapter.engine.player(playerIndex).field.some(isMonster)) score += 18;
    if (action === ACTIONS.END_TURN) score -= 8;
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && rng() < 0.5)) {
      best = { action, score };
    }
  }
  return best?.action ?? chooseRanked(adapter, playerIndex, genome, rng, new Set([ACTIONS.SPECIAL]));
}

export function chooseHomuraAction(adapter, playerIndex = adapter.currentPlayer(), rng = Math.random) {
  const engine = adapter.engine;
  if (engine.player(playerIndex).character?.id !== 'homura') return null;
  const legal = adapter.legalActions(playerIndex);
  if (!legal.length) return null;

  if (homuraSpecialActive(engine, playerIndex)) {
    const continuation = findHomuraActiveOtkContinuation(adapter, playerIndex);
    if (continuation?.length) return continuation[0];
  }

  if (legal.includes(ACTIONS.SPECIAL)) {
    const line = findHomuraOtkLine(adapter, playerIndex);
    if (line) return ACTIONS.SPECIAL;
  }

  if (engine.state.pendingDecision?.type === 'CHAIN_RESPONSE') {
    return chooseHomuraSetupChain(adapter, playerIndex, legal);
  }

  if (engine.state.activePlayer !== playerIndex) {
    return legal.includes(ACTIONS.PASS)
      ? ACTIONS.PASS
      : chooseRanked(adapter, playerIndex, HOMURA_GENOME, rng, new Set([ACTIONS.SPECIAL]));
  }

  if (engine.state.phase === PHASES.BATTLE) return chooseHomuraSetupBattle(adapter, playerIndex, legal);
  if (engine.state.phase === PHASES.BATTLE_START) {
    return legal.includes(ACTIONS.CONTINUE_BATTLE)
      ? ACTIONS.CONTINUE_BATTLE
      : chooseRanked(adapter, playerIndex, HOMURA_GENOME, rng, new Set([ACTIONS.SPECIAL]));
  }
  if (engine.state.phase === PHASES.MAIN) return chooseHomuraSetupMain(adapter, playerIndex, HOMURA_GENOME, rng, legal);

  return chooseRanked(adapter, playerIndex, HOMURA_GENOME, rng, new Set([ACTIONS.SPECIAL]));
}