import { ACTIONS, ATTACK_TARGETS, RL_LIMITS } from './rl-adapter.js';
import { inspectEvaluationActions } from './evaluation-ai.js';
import { NAGISA_GENOME, NAGISA_SPECIAL_THRESHOLD } from './nagisa-policy.js';

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

function bestTarget(engine, playerIndex, attackerSlot) {
  const opponent = engine.player(engine.opponent(playerIndex));
  const self = engine.player(playerIndex);
  const opponentTargets = monsterSlots(opponent.field).filter(slot => slot !== attackerSlot);
  const ownTargets = monsterSlots(self.field);
  const candidates = [];

  if (opponentTargets.length === 0) candidates.push({ side: 'direct', slot: null, score: targetScore(engine, playerIndex, attackerSlot, 'direct') });
  for (const slot of opponentTargets) candidates.push({ side: 'opponent', slot, score: targetScore(engine, playerIndex, attackerSlot, 'opponent', slot) });
  for (const slot of ownTargets) candidates.push({ side: 'self', slot, score: targetScore(engine, playerIndex, attackerSlot, 'self', slot) });

  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

function chooseForcedChain(adapter, playerIndex, legal) {
  const engine = adapter.engine;
  const state = engine.state;
  const battle = state.battle;
  const decision = state.pendingDecision;
  if (!battle?.nagisaForced || decision?.type !== 'CHAIN_RESPONSE' || decision.player !== playerIndex) return null;
  if (playerIndex !== battle.defenderPlayer || battle.direct) return legal.includes(ACTIONS.PASS) ? ACTIONS.PASS : legal[0] ?? null;

  const attack = battle.attackerBase + battle.attackerBonus;
  let defend = battle.defenderBase + battle.defenderBonus;
  for (const item of state.chain) if (item.card?.effect === 'boost' && item.player === battle.defenderPlayer) defend += item.card.value ?? 0;

  const hand = engine.player(playerIndex).hand;
  const shieldActions = [];
  const boostActions = [];
  for (const action of legal) {
    if (action < ACTIONS.CHAIN_BASE || action >= ACTIONS.REVIVE_BASE) continue;
    const card = hand[action - ACTIONS.CHAIN_BASE];
    if (card?.effect === 'nullifyDamage') shieldActions.push(action);
    if (card?.effect === 'boost') boostActions.push({ action, value: card.value ?? 0 });
  }

  if (attack >= defend && shieldActions.length) return shieldActions[0];
  if (attack >= defend) {
    const flip = boostActions.filter(item => defend + item.value > attack).sort((a, b) => a.value - b.value)[0];
    if (flip) return flip.action;
    const tie = boostActions.filter(item => defend + item.value === attack).sort((a, b) => a.value - b.value)[0];
    if (tie) return tie.action;
  }
  return legal.includes(ACTIONS.PASS) ? ACTIONS.PASS : legal[0] ?? null;
}

function chooseEvaluationActionWithoutSpecial(adapter, playerIndex, rng) {
  const ranked = inspectEvaluationActions(adapter, playerIndex, NAGISA_GENOME)
    .filter(item => item.action !== ACTIONS.SPECIAL);
  if (!ranked.length) return null;
  const best = ranked[0].score;
  const tied = ranked.filter(item => Math.abs(item.score - best) < 1e-9);
  return tied[Math.floor(rng() * tied.length)].action;
}

export function chooseNagisaAction(adapter, playerIndex = adapter.currentPlayer(), rng = Math.random) {
  const engine = adapter.engine;
  const state = engine.state;
  const legal = adapter.legalActions(playerIndex);
  if (!legal.length) return null;

  const forcedChain = chooseForcedChain(adapter, playerIndex, legal);
  if (forcedChain !== null) return forcedChain;

  const decision = state.pendingDecision;
  if (decision?.type === 'NAGISA_ATTACKER' && decision.player === playerIndex) {
    let best = null;
    for (const action of legal) {
      const slot = action - ACTIONS.REVIVE_BASE;
      const target = bestTarget(engine, playerIndex, slot);
      if (!target) continue;
      if (!best || target.score > best.score) best = { action, score: target.score };
    }
    return best?.action ?? legal[0];
  }

  if (decision?.type === 'NAGISA_TARGET' && decision.player === playerIndex) {
    let best = null;
    for (const action of legal) {
      let score = -Infinity;
      if (action >= ACTIONS.REVIVE_BASE && action < ACTIONS.COUNT) {
        score = targetScore(engine, playerIndex, decision.attackerSlot, 'opponent', action - ACTIONS.REVIVE_BASE);
      } else if (action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE) {
        const offset = action - ACTIONS.ATTACK_BASE;
        const attacker = Math.floor(offset / ATTACK_TARGETS);
        const target = offset % ATTACK_TARGETS;
        if (attacker !== decision.attackerSlot) continue;
        score = target === RL_LIMITS.FIELD_SLOTS
          ? targetScore(engine, playerIndex, attacker, 'direct')
          : targetScore(engine, playerIndex, attacker, 'self', target);
      }
      if (!best || score > best.score) best = { action, score };
    }
    return best?.action ?? legal[0];
  }

  if (engine.player(playerIndex).character?.id !== 'nagisa') return null;

  if (legal.includes(ACTIONS.SPECIAL)) {
    const attackerSlots = monsterSlots(engine.player(engine.opponent(playerIndex)).field);
    const best = attackerSlots.map(slot => bestTarget(engine, playerIndex, slot)).filter(Boolean).sort((a, b) => b.score - a.score)[0];
    if (best?.score > NAGISA_SPECIAL_THRESHOLD) return ACTIONS.SPECIAL;
    const normalAction = chooseEvaluationActionWithoutSpecial(adapter, playerIndex, rng);
    if (normalAction !== null) return normalAction;
  }

  const ranked = inspectEvaluationActions(adapter, playerIndex, NAGISA_GENOME);
  if (!ranked.length) return null;
  const best = ranked[0].score;
  const tied = ranked.filter(item => Math.abs(item.score - best) < 1e-9);
  return tied[Math.floor(rng() * tied.length)].action;
}
