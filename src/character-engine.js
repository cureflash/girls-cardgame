// Canonical browser/analysis entry point for all current character rules.
import { GameEngine as NagisaGameEngine, PHASES, CARD_TYPES } from './nagisa-engine.js';

export { PHASES, CARD_TYPES };

export class GameEngine extends NagisaGameEngine {
  canActivateMagic(playerIndex, card) {
    const battle = this.state.battle;
    if (
      card?.effect === 'nullifyDamage'
      && battle
      && !battle.direct
      && playerIndex === battle.attackerPlayer
      && (this.state.chain?.length ?? 0) === 0
    ) {
      return false;
    }
    return super.canActivateMagic(playerIndex, card);
  }
}
