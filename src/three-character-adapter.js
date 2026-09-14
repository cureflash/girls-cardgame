import {
  RLAdapter,
  ACTIONS,
  RL_LIMITS,
  encodeRevive,
  encodeSummon,
  tributeSlotsToMask,
  tributeMaskToSlots,
} from './rl-adapter.js';
import { CARD_TYPES } from './game-engine.js';

export class ThreeCharacterAdapter extends RLAdapter {
  legalActions(playerIndex = this.currentPlayer()) {
    const decision = this.engine.state.pendingDecision;
    if (decision?.type === 'SAYAKA_RECYCLE') {
      if (decision.player !== playerIndex) return [];
      const grave = this.engine.player(playerIndex).graveyard;
      return decision.options.flatMap(id => {
        const index = grave.findIndex(card => card.id === id);
        return index >= 0 && index < RL_LIMITS.MAX_GRAVE ? [encodeRevive(index)] : [];
      });
    }
    if (decision?.type === 'KYOKO_OPPONENT_TRIBUTE') {
      if (decision.player !== playerIndex) return [];
      return decision.options.map(slot => encodeRevive(slot));
    }
    if (decision?.type === 'KYOKO_WITCH_SUMMON') {
      if (decision.player !== playerIndex) return [];
      const p = this.engine.player(playerIndex);
      const actions = [];
      for (let handIndex = 0; handIndex < Math.min(p.hand.length, RL_LIMITS.MAX_HAND); handIndex++) {
        const card = p.hand[handIndex];
        if (card?.type !== CARD_TYPES.WITCH) continue;
        for (const plan of this.engine.validKyokoTributeSets(playerIndex, card, decision.opponentSlot)) {
          actions.push(encodeSummon(handIndex, tributeSlotsToMask(plan.slots)));
        }
      }
      return [...new Set(actions)];
    }
    return super.legalActions(playerIndex);
  }

  applyAction(action, playerIndex = this.currentPlayer()) {
    const decision = this.engine.state.pendingDecision;
    if (decision?.type === 'SAYAKA_RECYCLE') {
      if (!Number.isInteger(action) || action < ACTIONS.REVIVE_BASE || action >= ACTIONS.COUNT) {
        throw new Error('Invalid Sayaka recycle action.');
      }
      if (!this.legalActions(playerIndex).includes(action)) throw new Error(`Illegal action ${action} for player ${playerIndex}.`);
      const graveIndex = action - ACTIONS.REVIVE_BASE;
      const card = this.engine.player(playerIndex).graveyard[graveIndex];
      if (!card) throw new Error('Recycle card is missing.');
      this.stats.actions += 1;
      this.engine.selectRecycleTarget(playerIndex, card.id);
      this._afterAction();
      return;
    }
    if (decision?.type === 'KYOKO_OPPONENT_TRIBUTE') {
      if (!this.legalActions(playerIndex).includes(action)) throw new Error(`Illegal action ${action} for player ${playerIndex}.`);
      const opponentSlot = action - ACTIONS.REVIVE_BASE;
      this.stats.actions += 1;
      this.engine.selectKyokoOpponentTribute(playerIndex, opponentSlot);
      this._afterAction();
      return;
    }
    if (decision?.type === 'KYOKO_WITCH_SUMMON') {
      if (!this.legalActions(playerIndex).includes(action)) throw new Error(`Illegal action ${action} for player ${playerIndex}.`);
      if (action < ACTIONS.SUMMON_BASE || action >= ACTIONS.ATTACK_BASE) throw new Error('Invalid Kyoko summon action.');
      const offset = action - ACTIONS.SUMMON_BASE;
      const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
      const tributeMask = offset % RL_LIMITS.TRIBUTE_MASKS;
      const card = this.engine.player(playerIndex).hand[handIndex];
      if (!card || card.type !== CARD_TYPES.WITCH) throw new Error('Kyoko summon witch is missing.');
      this.stats.actions += 1;
      this.stats.summons[playerIndex] += 1;
      this.stats.witchSummons[playerIndex] += 1;
      this.engine.resolveKyokoWitchSummon(playerIndex, card.id, tributeMaskToSlots(tributeMask));
      this._afterAction();
      return;
    }
    return super.applyAction(action, playerIndex);
  }
}
