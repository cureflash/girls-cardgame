import { CARD_TYPES } from './character-engine.js';
import { ACTIONS, RL_LIMITS, tributeMaskToSlots } from './rl-adapter.js';
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

function chooseRanked(adapter, playerIndex, genome, excluded = new Set()) {
  const ranked = inspectEvaluationActions(adapter, playerIndex, genome)
    .filter(item => !excluded.has(item.action));
  if (!ranked.length) return null;
  return ranked[0].action;
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

function homuraSpecialScore(engine, playerIndex) {
  const self = engine.player(playerIndex);
  const opp = engine.player(engine.opponent(playerIndex));
  const attackers = self.field.filter(card => isMonster(card) && card.attackedTurn !== engine.state.turn);
  if (!attackers.length) return -Infinity;

  const maxAttack = Math.max(...attackers.map(card => card.attack ?? 0));
  const maxBoost = Math.max(0, ...self.hand.filter(card => card?.effect === 'boost').map(card => card.value ?? 0));
  const oppMonsters = opp.field.filter(isMonster);
  if (!oppMonsters.length && maxAttack >= opp.deck.length) return 10000;

  const bestVisibleSwing = oppMonsters.length
    ? Math.max(...attackers.flatMap(attacker => oppMonsters.map(defender =>
      (attacker.attack ?? 0) + maxBoost - (defender.attack ?? 0))))
    : maxAttack + maxBoost;

  return attackers.length * 22
    + maxAttack * 5
    + maxBoost * 9
    + Math.max(0, bestVisibleSwing) * 7
    + opp.hand.length * 5;
}

function specialScore(character, engine, playerIndex) {
  if (character === 'sayaka') return sayakaSpecialScore(engine, playerIndex);
  if (character === 'kyoko') return bestKyokoPlan(engine, playerIndex)?.score ?? -Infinity;
  if (character === 'homura') return homuraSpecialScore(engine, playerIndex);
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

export function chooseRemainingCharacterAction(adapter, playerIndex = adapter.currentPlayer()) {
  const engine = adapter.engine;
  const character = engine.player(playerIndex).character?.id;
  const policy = POLICY[character];
  if (!policy) return null;

  const legal = adapter.legalActions(playerIndex);
  if (!legal.length) return null;

  const pending = choosePending(character, adapter, playerIndex, legal);
  if (pending !== null) return pending;

  if (legal.includes(ACTIONS.SPECIAL)) {
    if (specialScore(character, engine, playerIndex) >= policy.threshold) return ACTIONS.SPECIAL;
    const normal = chooseRanked(adapter, playerIndex, policy.genome, new Set([ACTIONS.SPECIAL]));
    if (normal !== null) return normal;
  }

  return chooseRanked(adapter, playerIndex, policy.genome);
}

export function dedicatedPolicy(characterId) {
  return POLICY[characterId] ?? null;
}
