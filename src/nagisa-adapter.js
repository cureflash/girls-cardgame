import { ThreeCharacterAdapter } from './three-character-adapter.js';
import {
  ACTIONS,
  ATTACK_TARGETS,
  RL_LIMITS,
  encodeAttack,
  encodeRevive,
} from './rl-adapter.js';

export class NagisaAdapter extends ThreeCharacterAdapter {
  legalActions(playerIndex = this.currentPlayer()) {
    const decision = this.engine.state.pendingDecision;
    if (decision?.type === 'NAGISA_ATTACKER') {
      if (decision.player !== playerIndex) return [];
      return decision.options.map(slot => encodeRevive(slot));
    }
    if (decision?.type === 'NAGISA_TARGET') {
      if (decision.player !== playerIndex) return [];
      const actions = [
        ...decision.opponentTargets.map(slot => encodeRevive(slot)),
        ...decision.ownTargets.map(slot => encodeAttack(decision.attackerSlot, slot)),
      ];
      if (decision.directAllowed) actions.push(encodeAttack(decision.attackerSlot, null));
      return [...new Set(actions)];
    }
    return super.legalActions(playerIndex);
  }

  applyAction(action, playerIndex = this.currentPlayer()) {
    const decision = this.engine.state.pendingDecision;
    if (decision?.type === 'NAGISA_ATTACKER') {
      if (!this.legalActions(playerIndex).includes(action)) throw new Error(`Illegal action ${action} for player ${playerIndex}.`);
      const opponentSlot = action - ACTIONS.REVIVE_BASE;
      this.stats.actions += 1;
      this.engine.selectNagisaAttacker(playerIndex, opponentSlot);
      this._afterAction();
      return;
    }
    if (decision?.type === 'NAGISA_TARGET') {
      if (!this.legalActions(playerIndex).includes(action)) throw new Error(`Illegal action ${action} for player ${playerIndex}.`);
      this.stats.actions += 1;

      if (action >= ACTIONS.REVIVE_BASE && action < ACTIONS.COUNT) {
        this.engine.resolveNagisaForcedBattle(playerIndex, 'opponent', action - ACTIONS.REVIVE_BASE);
      } else if (action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE) {
        const offset = action - ACTIONS.ATTACK_BASE;
        const attackerSlot = Math.floor(offset / ATTACK_TARGETS);
        const target = offset % ATTACK_TARGETS;
        if (attackerSlot !== decision.attackerSlot) throw new Error('Nagisa forced attacker changed unexpectedly.');
        this.engine.resolveNagisaForcedBattle(
          playerIndex,
          target === RL_LIMITS.FIELD_SLOTS ? 'direct' : 'self',
          target === RL_LIMITS.FIELD_SLOTS ? null : target,
        );
      } else {
        throw new Error('Invalid Nagisa forced battle action.');
      }
      this._afterAction();
      return;
    }
    return super.applyAction(action, playerIndex);
  }
}
