// Canonical browser/analysis entry point for all current character rules.
import { GameEngine as NagisaGameEngine, PHASES, CARD_TYPES } from './nagisa-engine.js';

export { PHASES, CARD_TYPES };

const isMonster = card => !!card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type);

export class GameEngine extends NagisaGameEngine {
  destroy(playerIndex, slot, reason) {
    const player = this.player(playerIndex);
    const card = player.field[slot];
    const battleDestruction = reason === 'battle' || reason === 'nagisa-forced-battle';
    if (card && battleDestruction && this.state.battle?.shieldPreventsBattleDestruction) {
      this.emit('destroyPrevented', {
        player: playerIndex,
        slot,
        card: { ...card },
        reason,
        prevention: 'shield',
      });
      this.log(`盾の効果で${card.name}の戦闘破壊を防いだ`);
      return;
    }
    if (
      card
      && player.character?.id === 'nagisa'
      && card.type === CARD_TYPES.FAMILIAR
      && battleDestruction
      && player.nagisaFamiliarReturnTurn !== this.state.turn
    ) {
      player.field[slot] = null;
      player.hand.push(card);
      player.nagisaFamiliarReturnTurn = this.state.turn;
      this.emit('destroy', {
        player: playerIndex,
        slot,
        card: { ...card },
        reason,
        replacement: 'nagisa-familiar-return',
      });
      this.emit('returnToHand', {
        player: playerIndex,
        card: { ...card },
        reason: 'nagisa-passive',
      });
      this.log(`${player.name}のパッシブで${card.name}を手札に戻した`);
      return;
    }
    return super.destroy(playerIndex, slot, reason);
  }

  nagisaAttackerOptions(playerIndex) {
    const options = super.nagisaAttackerOptions(playerIndex);
    const opponentPlayer = this.opponent(playerIndex);
    const opponentSlots = this.nagisaMonsterSlots(playerIndex).opponent;
    if (opponentSlots.length === 1) {
      const slot = opponentSlots[0];
      const attacker = this.player(opponentPlayer).field[slot];
      if (isMonster(attacker) && attacker.attackedTurn !== this.state.turn && !options.opponent.includes(slot)) {
        options.opponent.push(slot);
      }
    }
    return options;
  }

  selectNagisaAttacker(playerIndex, attackerSide, attackerSlot) {
    const d = this.state.pendingDecision;
    const opponentPlayer = this.opponent(playerIndex);
    const opponentSlots = this.nagisaMonsterSlots(playerIndex).opponent;
    const loneOpponentDirect = attackerSide === 'opponent'
      && opponentSlots.length === 1
      && opponentSlots[0] === attackerSlot;

    if (!loneOpponentDirect) return super.selectNagisaAttacker(playerIndex, attackerSide, attackerSlot);
    if (!d || d.type !== 'NAGISA_ATTACKER' || d.player !== playerIndex || !d.opponentOptions.includes(attackerSlot)) {
      throw new Error('Invalid Nagisa attacker target.');
    }

    const attacker = this.player(opponentPlayer).field[attackerSlot];
    if (!isMonster(attacker) || attacker.attackedTurn === this.state.turn) {
      throw new Error('Nagisa attacker target is no longer available.');
    }

    const ownTargets = this.player(playerIndex).field
      .map((card, slot) => isMonster(card) ? slot : null)
      .filter(slot => slot !== null);

    this.state.pendingDecision = {
      type: 'NAGISA_TARGET',
      player: playerIndex,
      opponentPlayer,
      attackerPlayer: opponentPlayer,
      attackerSide,
      attackerSlot,
      attackerCardId: attacker.id,
      opponentTargets: [],
      ownTargets,
      directAllowed: true,
    };
    this.log(`${this.player(playerIndex).name}は${attacker.name}を操作する`);
  }

  resolveNagisaForcedBattle(playerIndex, targetSide, targetSlot = null) {
    if (targetSide !== 'direct') return super.resolveNagisaForcedBattle(playerIndex, targetSide, targetSlot);

    const d = this.state.pendingDecision;
    if (!d || d.type !== 'NAGISA_TARGET' || d.player !== playerIndex) {
      throw new Error('No Nagisa forced battle is pending.');
    }
    const attacker = this.player(d.attackerPlayer).field[d.attackerSlot];
    if (!isMonster(attacker) || attacker.id !== d.attackerCardId || attacker.attackedTurn === this.state.turn) {
      throw new Error('Nagisa controlled attacker is no longer available.');
    }

    const opponentSlots = this.nagisaMonsterSlots(playerIndex).opponent;
    const ownDirect = d.attackerPlayer === playerIndex && opponentSlots.length === 0;
    const loneOpponentDirect = d.attackerPlayer === d.opponentPlayer
      && opponentSlots.length === 1
      && opponentSlots[0] === d.attackerSlot;
    if (!d.directAllowed || targetSlot !== null || (!ownDirect && !loneOpponentDirect)) {
      throw new Error('Nagisa direct attack is not available in the current field state.');
    }

    this.state.pendingDecision = null;
    attacker.attackedTurn = this.state.turn;
    this.state.battle = {
      attackerPlayer: d.attackerPlayer,
      attackerSlot: d.attackerSlot,
      defenderPlayer: d.opponentPlayer,
      defenderSlot: null,
      direct: true,
      attackerBase: attacker.attack ?? 0,
      defenderBase: 0,
      attackerBonus: 0,
      defenderBonus: 0,
      damagePrevented: [false, false],
      endBattlePhase: false,
      nagisaForced: true,
      forcedBy: playerIndex,
      forcedTargetSide: 'direct',
      forcedAttackerProtected: false,
    };
    this.state.resumePhase = PHASES.BATTLE;
    this.state.chainPassCount = 0;
    this.log(`${this.player(playerIndex).name}「強制戦闘」— ${attacker.name}で直接攻撃`);
    this.emit('attack', { ...structuredClone(this.state.battle), special: 'nagisa' });
    this.beginChainWindow(playerIndex);
  }

  resolveMagic(playerIndex, card) {
    let resolvedCard = card;
    if (card?.effect === 'boost' && this.player(playerIndex).character?.id === 'homura') {
      resolvedCard = { ...card, value: (card.value ?? 0) + 2 };
      this.log(`${this.player(playerIndex).name}のパッシブで${card.name}の効果量を＋2`);
    }
    if (card?.effect === 'nullifyDamage' && this.state.battle) {
      this.state.battle.shieldPreventsBattleDestruction = true;
    }
    return super.resolveMagic(playerIndex, resolvedCard);
  }

  canActivateMagic(playerIndex, card) {
    const battle = this.state.battle;
    if (
      card?.effect === 'nullifyDamage'
      && battle
      && !battle.nagisaForced
      && !battle.direct
      && playerIndex === battle.attackerPlayer
      && (this.state.chain?.length ?? 0) === 0
    ) {
      return false;
    }
    return super.canActivateMagic(playerIndex, card);
  }
}