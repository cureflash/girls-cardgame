import {
  ACTIONS,
  ATTACK_TARGETS,
  RL_LIMITS,
  encodeAttack,
  encodeRevive,
} from './rl-adapter.js';
import { inspectEvaluationActions } from './evaluation-ai.js';
import { NAGISA_GENOME, NAGISA_SPECIAL_THRESHOLD } from './nagisa-policy.js';

function monster(card) {
  return !!card && (card.type === 'familiar' || card.type === 'witch');
}

function cardValue(card) {
  if (!monster(card)) return 0;
  return 12 + (card.attack ?? 0) * 7 + (card.type === 'witch' ? 14 : 0);
}

function ownerScore(playerIndex, owner, value) {
  return owner === playerIndex ? -value : value;
}

function damageScore(playerIndex, damagedPlayer, amount) {
  return damagedPlayer === playerIndex ? -amount * 15 : amount * 12;
}

function directAllowedFor(engine, playerIndex, attackerPlayer, attackerSlot) {
  const opponentPlayer = engine.opponent(playerIndex);
  const opponentSlots = engine.player(opponentPlayer).field
    .map((card, slot) => monster(card) ? slot : null)
    .filter(slot => slot !== null);
  if (attackerPlayer === playerIndex) return opponentSlots.length === 0;
  return attackerPlayer === opponentPlayer
    && opponentSlots.length === 1
    && opponentSlots[0] === attackerSlot;
}

function battleScore(engine, playerIndex, attackerPlayer, attackerSlot, targetSide, targetSlot = null, attackBonus = 0) {
  const opponentPlayer = engine.opponent(playerIndex);
  const attacker = engine.player(attackerPlayer).field[attackerSlot];
  if (!monster(attacker)) return -Infinity;
  const attack = (attacker.attack ?? 0) + attackBonus;

  if (targetSide === 'direct') {
    if (!directAllowedFor(engine, playerIndex, attackerPlayer, attackerSlot)) return -Infinity;
    const lethal = attack >= engine.player(opponentPlayer).deck.length ? 10000 : 0;
    return lethal + damageScore(playerIndex, opponentPlayer, attack);
  }

  const defenderPlayer = targetSide === 'self' ? playerIndex
    : targetSide === 'opponent' ? opponentPlayer
    : null;
  if (defenderPlayer === null) return -Infinity;
  if (defenderPlayer === attackerPlayer && targetSlot === attackerSlot) return -Infinity;
  const defender = engine.player(defenderPlayer).field[targetSlot];
  if (!monster(defender)) return -Infinity;
  const defend = defender.attack ?? 0;

  if (attack === defend) {
    return ownerScore(playerIndex, attackerPlayer, cardValue(attacker))
      + ownerScore(playerIndex, defenderPlayer, cardValue(defender));
  }
  if (attack > defend) {
    const damage = attack - defend;
    const lethal = defenderPlayer === opponentPlayer && damage >= engine.player(opponentPlayer).deck.length ? 10000 : 0;
    return lethal
      + ownerScore(playerIndex, defenderPlayer, cardValue(defender))
      + damageScore(playerIndex, defenderPlayer, damage);
  }

  const damage = defend - attack;
  const lethal = attackerPlayer === opponentPlayer && damage >= engine.player(opponentPlayer).deck.length ? 10000 : 0;
  return lethal
    + ownerScore(playerIndex, attackerPlayer, cardValue(attacker))
    + damageScore(playerIndex, attackerPlayer, damage);
}

function bestTarget(engine, playerIndex, attackerSide, attackerSlot) {
  const attackerPlayer = attackerSide === 'self' ? playerIndex : engine.opponent(playerIndex);
  const candidates = [];
  for (let slot = 0; slot < RL_LIMITS.FIELD_SLOTS; slot++) {
    const own = engine.player(playerIndex).field[slot];
    if (monster(own) && !(attackerPlayer === playerIndex && slot === attackerSlot)) {
      candidates.push({ side: 'self', slot, score: battleScore(engine, playerIndex, attackerPlayer, attackerSlot, 'self', slot) });
    }
    const opp = engine.player(engine.opponent(playerIndex)).field[slot];
    if (monster(opp) && !(attackerPlayer === engine.opponent(playerIndex) && slot === attackerSlot)) {
      candidates.push({ side: 'opponent', slot, score: battleScore(engine, playerIndex, attackerPlayer, attackerSlot, 'opponent', slot) });
    }
  }
  if (directAllowedFor(engine, playerIndex, attackerPlayer, attackerSlot)) {
    candidates.push({ side: 'direct', slot: null, score: battleScore(engine, playerIndex, attackerPlayer, attackerSlot, 'direct') });
  }
  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

export function nagisaSpecialScore(engine, playerIndex) {
  if (engine.player(playerIndex).character?.id !== 'nagisa') return -Infinity;
  const options = engine.nagisaAttackerOptions?.(playerIndex);
  if (!options) return -Infinity;
  const scores = [
    ...options.own.map(slot => bestTarget(engine, playerIndex, 'self', slot)?.score ?? -Infinity),
    ...options.opponent.map(slot => bestTarget(engine, playerIndex, 'opponent', slot)?.score ?? -Infinity),
  ].filter(Number.isFinite).filter(score => score > 0).sort((a, b) => b - a);
  if (!scores.length) return -Infinity;
  const opponentMonsters = engine.player(engine.opponent(playerIndex)).field.filter(monster).length;
  return scores.slice(0, 4).reduce((sum, score) => sum + score, 0)
    + Math.max(0, opponentMonsters - 1) * 18;
}

function queuedBoost(state) {
  return state.chain.reduce((sum, item) => sum + (item.card?.effect === 'boost' ? item.card.value ?? 0 : 0), 0);
}

function chooseForcedChain(adapter, playerIndex, legal) {
  const engine = adapter.engine;
  const state = engine.state;
  const battle = state.battle;
  const decision = state.pendingDecision;
  if (!battle?.nagisaForced || decision?.type !== 'CHAIN_RESPONSE' || decision.player !== playerIndex || battle.forcedBy !== playerIndex) return null;

  const hand = engine.player(playerIndex).hand;
  const boostActions = [];
  let shieldAction = null;
  for (const action of legal) {
    if (action < ACTIONS.CHAIN_BASE || action >= ACTIONS.REVIVE_BASE) continue;
    const card = hand[action - ACTIONS.CHAIN_BASE];
    if (card?.effect === 'boost') boostActions.push({ action, value: card.value ?? 0 });
    if (card?.effect === 'nullifyDamage') shieldAction = action;
  }

  const currentBonus = queuedBoost(state);
  const targetSide = battle.direct ? 'direct' : battle.defenderPlayer === playerIndex ? 'self' : 'opponent';
  const base = battleScore(
    engine,
    playerIndex,
    battle.attackerPlayer,
    battle.attackerSlot,
    targetSide,
    battle.defenderSlot,
    currentBonus,
  );

  let best = { action: ACTIONS.PASS, score: base };
  for (const item of boostActions) {
    const score = battleScore(
      engine,
      playerIndex,
      battle.attackerPlayer,
      battle.attackerSlot,
      targetSide,
      battle.defenderSlot,
      currentBonus + item.value,
    ) - 12;
    if (score > best.score + 10) best = { action: item.action, score };
  }

  if (!battle.direct && shieldAction !== null && battle.attackerPlayer === playerIndex) {
    const attack = battle.attackerBase + battle.attackerBonus + currentBonus;
    const defend = battle.defenderBase + battle.defenderBonus;
    if (attack <= defend) {
      const saved = cardValue(engine.player(playerIndex).field[battle.attackerSlot]) + Math.max(0, defend - attack) * 15 - 35;
      if (base + saved > best.score + 12) best = { action: shieldAction, score: base + saved };
    }
  }
  return legal.includes(best.action) ? best.action : legal.includes(ACTIONS.PASS) ? ACTIONS.PASS : legal[0] ?? null;
}

function chooseEvaluationAction(adapter, playerIndex, genome, rng, excluded = new Set()) {
  const ranked = inspectEvaluationActions(adapter, playerIndex, genome)
    .filter(item => !excluded.has(item.action));
  if (!ranked.length) return null;
  const best = ranked[0].score;
  const tied = ranked.filter(item => Math.abs(item.score - best) < 1e-9);
  return tied[Math.floor(rng() * tied.length)].action;
}

function chooseAttacker(adapter, playerIndex, legal) {
  const engine = adapter.engine;
  const d = engine.state.pendingDecision;
  let best = { action: ACTIONS.END_TURN, score: 0 };
  for (const slot of d.ownOptions ?? []) {
    const action = encodeAttack(slot, null);
    if (!legal.includes(action)) continue;
    const target = bestTarget(engine, playerIndex, 'self', slot);
    if (target && target.score > best.score) best = { action, score: target.score };
  }
  for (const slot of d.opponentOptions ?? []) {
    const action = encodeRevive(slot);
    if (!legal.includes(action)) continue;
    const target = bestTarget(engine, playerIndex, 'opponent', slot);
    if (target && target.score > best.score) best = { action, score: target.score };
  }
  return legal.includes(best.action) ? best.action : legal[0] ?? null;
}

function chooseTarget(adapter, playerIndex, legal) {
  const engine = adapter.engine;
  const d = engine.state.pendingDecision;
  let best = null;
  for (const action of legal) {
    let side = null;
    let slot = null;
    if (action >= ACTIONS.REVIVE_BASE && action < ACTIONS.COUNT) {
      side = 'opponent';
      slot = action - ACTIONS.REVIVE_BASE;
    } else if (action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE) {
      const offset = action - ACTIONS.ATTACK_BASE;
      const attackerSlot = Math.floor(offset / ATTACK_TARGETS);
      const target = offset % ATTACK_TARGETS;
      if (attackerSlot !== d.attackerSlot) continue;
      side = target === RL_LIMITS.FIELD_SLOTS ? 'direct' : 'self';
      slot = target === RL_LIMITS.FIELD_SLOTS ? null : target;
    }
    if (!side) continue;
    const score = battleScore(engine, playerIndex, d.attackerPlayer, d.attackerSlot, side, slot);
    if (!best || score > best.score) best = { action, score };
  }
  return best?.action ?? legal[0] ?? null;
}

export function chooseNagisaActionWithPolicy(
  adapter,
  playerIndex = adapter.currentPlayer(),
  { genome = NAGISA_GENOME, threshold = NAGISA_SPECIAL_THRESHOLD } = {},
  rng = Math.random,
) {
  const engine = adapter.engine;
  const state = engine.state;
  const legal = adapter.legalActions(playerIndex);
  if (!legal.length) return null;

  const forcedChain = chooseForcedChain(adapter, playerIndex, legal);
  if (forcedChain !== null) return forcedChain;

  const decision = state.pendingDecision;
  if (decision?.type === 'NAGISA_ATTACKER' && decision.player === playerIndex) return chooseAttacker(adapter, playerIndex, legal);
  if (decision?.type === 'NAGISA_TARGET' && decision.player === playerIndex) return chooseTarget(adapter, playerIndex, legal);

  if (engine.player(playerIndex).character?.id !== 'nagisa') return null;

  if (legal.includes(ACTIONS.SPECIAL)) {
    const score = nagisaSpecialScore(engine, playerIndex);
    if (score >= threshold) return ACTIONS.SPECIAL;
    const normalAction = chooseEvaluationAction(adapter, playerIndex, genome, rng, new Set([ACTIONS.SPECIAL]));
    if (normalAction !== null) return normalAction;
  }

  return chooseEvaluationAction(adapter, playerIndex, genome, rng);
}

export function chooseNagisaAction(adapter, playerIndex = adapter.currentPlayer(), rng = Math.random) {
  return chooseNagisaActionWithPolicy(adapter, playerIndex, undefined, rng);
}
