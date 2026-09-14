import { RLAdapter, ACTIONS, RL_LIMITS, encodeRevive } from './rl-adapter.js';

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
    return super.legalActions(playerIndex);
  }

  applyAction(action, playerIndex = this.currentPlayer()) {
    const decision = this.engine.state.pendingDecision;
    if (decision?.type !== 'SAYAKA_RECYCLE') return super.applyAction(action, playerIndex);
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
  }
}
