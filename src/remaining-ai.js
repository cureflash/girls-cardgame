import { CARD_TYPES, PHASES } from './character-engine.js';
import { ACTIONS, ATTACK_TARGETS, RL_LIMITS, tributeMaskToSlots } from './rl-adapter.js';
import { inspectEvaluationActions } from './evaluation-ai.js';
import {
  SAYAKA_GENOME,
  SAYAKA_SPECIAL_THRESHOLD,
  KYOKO_GENOME,
  KYOKO_SPECIAL_THRESHOLD,
  HOMURA_GENOME,
  HOMURA_SPECIAL_THRESHOLD,
} from './remaining-policies.js';

const POLICY = Object.freeze({
  sayaka: { genome: SAYAKA_GENOME, threshold: SAYAKA_SPECIAL_THRESHOLD },
  kyoko: { genome: KYOKO_GENOME, threshold: KYOKO_SPECIAL_THRESHOLD },
  homura: { genome: HOMURA_GENOME, threshold: HOMURA_SPECIAL_THRESHOLD },
});

const isMonster = card => !!card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type);

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

  const recover = [...self.graveyard]
    .sort((a, b) => recycleValue(b) - recycleValue(a))
    .slice(0, 3);
  const recoverScore = recover.reduce((sum, card) => sum + recycleValue(card), 0) / 3;
  const urgency = Math.max(0, 18 - self.deck.length) * 9;
  const attackers = self.field.filter(isMonster);
  if (opp.field.every(card => !isMonster(card)) && attackers.some(card => (card.attack ?? 0) >= opp.deck.length)) {
    return -Infinity;
  }
  return recoverScore + urgency - attackers.length * 13;
}

function kyokoPlanScore(engine, playerIndex, opponentSlot, witch, plan) {
  const opponent = engine.player(engine.opponent(playerIndex));
  const self = engine.player(playerIndex);
  const target = opponent.field[opponentSlot];
  if (!isMonster(target) || witch?.type !== CARD_TYPES.WITCH || !plan) return -Infinity;

  const ownFieldPower = plan.slots.reduce((sum, slot) => sum + (self.field[slot]?.attack ?? 0), 0);
  const ownHandPower = (plan.handIds ?? []).reduce(
    (sum, id) => sum + (self.hand.find(card => card.id === id)?.attack ?? 0),
    0,
  );
  const ownCards = plan.slots.length + (plan.handIds?.length ?? 0);
  return (target.attack ?? 0) * 9
    + (witch.attack ?? 0) * 8
    - (ownFieldPower + ownHandPower) * 4
    - ownCards * 8
    + ((witch.attack ?? 0) >= 13 ? 25 : 0)
    + (target.type === CARD_TYPES.WITCH ? 15 : 0);
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

function specialScore(character, engine, playerIndex) {
  if (character === 'sayaka') return sayakaSpecialScore(engine, playerIndex);
  if (character === 'kyoko') return bestKyokoPlan(engine, playerIndex)?.score ?? -Infinity;
  return -Infinity;
}

function choosePending(character, adapter, playerIndex, legal) {
  const engine = adapter.engine;
  const decision = engine.state.pendingDecision;
  if (!decision || decision.player !== playerIndex) return null;

  if (character === 'sayaka' && decision.type === 'SAYAKA_RECYCLE') {
    const graveyard = engine.player(playerIndex).graveyard;
    let best = null;
    for (const action of legal) {
      const card = graveyard[action - ACTIONS.REVIVE_BASE];
      const score = recycleValue(card);
      if (!best || score > best.score) best = { action, score };
    }
    return best?.action ?? legal[0];
  }

  if (character === 'kyoko' && decision.type === 'KYOKO_OPPONENT_TRIBUTE') {
    let best = null;
    for (const action of legal) {
      const slot = action - ACTIONS.REVIVE_BASE;
      const plan = bestKyokoPlan(engine, playerIndex, slot);
      if (plan && (!best || plan.score > best.score)) best = { action, score: plan.score };
    }
    return best?.action ?? legal[0];
  }

  if (character === 'kyoko' && decision.type === 'KYOKO_WITCH_SUMMON') {
    const self = engine.player(playerIndex);
    let best = null;
    for (const action of legal) {
      const offset = action - ACTIONS.SUMMON_BASE;
      const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
      const slots = tributeMaskToSlots(offset % RL_LIMITS.TRIBUTE_MASKS);
      const witch = self.hand[handIndex];
      const plan = engine.validKyokoTributeSets(playerIndex, witch, decision.opponentSlot)
        .find(candidate => candidate.slots.length === slots.length
          && candidate.slots.every((slot, index) => slot === slots[index]));
      const score = kyokoPlanScore(engine, playerIndex, decision.opponentSlot, witch, plan);
      if (!best || score > best.score) best = { action, score };
    }
    return best?.action ?? legal[0];
  }

  return null;
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
    state.homuraExtraMonsterSummon,
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

function homuraOtkSearchActions(adapter, playerIndex) {
  const engine = adapter.engine;
  const legal = adapter.legalActions(playerIndex);
  const pending = engine.state.pendingDecision;

  if (pending?.type === 'CHAIN_RESPONSE') {
    return legal
      .filter(action => action === ACTIONS.PASS || chainCardForAction(adapter, playerIndex, action)?.effect === 'boost')
      .sort((a, b) => {
        if (a === ACTIONS.PASS) return -1;
        if (b === ACTIONS.PASS) return 1;
        return (chainCardForAction(adapter, playerIndex, a)?.value ?? 0)
          - (chainCardForAction(adapter, playerIndex, b)?.value ?? 0);
      });
  }

  if (engine.state.phase === PHASES.BATTLE_START) {
    return legal
      .filter(action => action === ACTIONS.CONTINUE_BATTLE
        || (action >= ACTIONS.SUMMON_BASE && action < ACTIONS.ATTACK_BASE))
      .sort((a, b) => {
        if (a === ACTIONS.CONTINUE_BATTLE) return 1;
        if (b === ACTIONS.CONTINUE_BATTLE) return -1;
        const cardA = engine.player(playerIndex).hand[Math.floor((a - ACTIONS.SUMMON_BASE) / RL_LIMITS.TRIBUTE_MASKS)];
        const cardB = engine.player(playerIndex).hand[Math.floor((b - ACTIONS.SUMMON_BASE) / RL_LIMITS.TRIBUTE_MASKS)];
        return (cardB?.attack ?? 0) - (cardA?.attack ?? 0);
      });
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

  const actions = homuraOtkSearchActions(adapter, playerIndex);
  for (const action of actions) {
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
  const boostPower = boosts.reduce((sum, card) => sum + (card.value ?? 0), 0);
  const freeMonster = self.hand.filter(isMonster).sort((a, b) => (b.attack ?? 0) - (a.attack ?? 0))[0] ?? null;
  const oppMonsters = opp.field.filter(isMonster);
  const oppPower = oppMonsters.reduce((sum, card) => sum + (card.attack ?? 0), 0);
  const burst = fieldPower + (freeMonster?.attack ?? 0) + boostPower;
  const deckPressure = Math.max(0, 30 - opp.deck.length);

  return field.length * 90
    + fieldPower * 14
    + boosts.length * 32
    + boostPower * 20
    + (freeMonster?.attack ?? 0) * 12
    + Math.max(-30, burst - opp.deck.length) * 9
    + deckPressure * 10
    - oppMonsters.length * 24
    - oppPower * 2
    + self.deck.length * 0.5
    - (self.specialUsed ? 10000 : 0);
}

function homuraProjectedBattleValues(engine) {
  const battle = engine.state.battle;
  if (!battle) return null;
  let attacker = battle.attackerBase + battle.attackerBonus;
  let defender = battle.defenderBase + battle.defenderBonus;
  for (const item of engine.state.chain) {
    if (item.card?.effect !== 'boost') continue;
    if (item.player === battle.attackerPlayer) attacker += item.card.value ?? 0;
    else if (item.player === battle.defenderPlayer) defender += item.card.value ?? 0;
  }
  return { attacker, defender };
}

function chooseHomuraSetupChain(adapter, playerIndex, legal) {
  const engine = adapter.engine;
  const battle = engine.state.battle;
  if (!battle) return legal.includes(ACTIONS.PASS) ? ACTIONS.PASS : legal[0];
  const values = homuraProjectedBattleValues(engine);
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

export function chooseHomuraSetupAction(adapter, playerIndex = adapter.currentPlayer(), genome = HOMURA_GENOME, rng = Math.random) {
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
    return legal.includes(ACTIONS.PASS) ? ACTIONS.PASS : chooseRanked(adapter, playerIndex, genome, rng, new Set([ACTIONS.SPECIAL]));
  }

  if (engine.state.phase === PHASES.BATTLE) return chooseHomuraSetupBattle(adapter, playerIndex, legal);
  if (engine.state.phase === PHASES.BATTLE_START) {
    return legal.includes(ACTIONS.CONTINUE_BATTLE)
      ? ACTIONS.CONTINUE_BATTLE
      : chooseRanked(adapter, playerIndex, genome, rng, new Set([ACTIONS.SPECIAL]));
  }
  if (engine.state.phase === PHASES.MAIN) return chooseHomuraSetupMain(adapter, playerIndex, genome, rng, legal);

  return chooseRanked(adapter, playerIndex, genome, rng, new Set([ACTIONS.SPECIAL]));
}

export function chooseRemainingCharacterAction(adapter, playerIndex = adapter.currentPlayer(), rng = Math.random) {
  const engine = adapter.engine;
  const character = engine.player(playerIndex).character?.id;
  const policy = POLICY[character];
  if (!policy) return null;

  if (character === 'homura') return chooseHomuraSetupAction(adapter, playerIndex, policy.genome, rng);

  const legal = adapter.legalActions(playerIndex);
  if (!legal.length) return null;

  const pending = choosePending(character, adapter, playerIndex, legal);
  if (pending !== null) return pending;

  if (legal.includes(ACTIONS.SPECIAL)) {
    if (specialScore(character, engine, playerIndex) >= policy.threshold) return ACTIONS.SPECIAL;
    const normal = chooseRanked(adapter, playerIndex, policy.genome, rng, new Set([ACTIONS.SPECIAL]));
    if (normal !== null) return normal;
  }

  return chooseRanked(adapter, playerIndex, policy.genome, rng);
}

export function dedicatedPolicy(characterId) {
  return POLICY[characterId] ?? null;
}
