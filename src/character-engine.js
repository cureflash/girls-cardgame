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

  _homuraExtraWitchAvailable(playerIndex, cardId = null) {
    const marker = this.state.homuraExtraWitchSummon;
    if (!marker || marker.player !== playerIndex || marker.turn !== this.state.turn) return false;
    if (this.state.phase !== PHASES.BATTLE_START || this.state.pendingDecision) return false;
    if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
    const player = this.player(playerIndex);
    if (!player.field.includes(null)) return false;
    if (cardId === null) return player.hand.some(card => card.type === CARD_TYPES.WITCH);
    return player.hand.some(card => card.id === cardId && card.type === CARD_TYPES.WITCH);
  }

  canSummon(playerIndex, cardId) {
    if (this._homuraExtraWitchAvailable(playerIndex, cardId)) return true;
    return super.canSummon(playerIndex, cardId);
  }

  validTributeSets(playerIndex, witchCard) {
    if (witchCard?.type === CARD_TYPES.WITCH && this._homuraExtraWitchAvailable(playerIndex, witchCard.id)) {
      return [{ slots: [], handIds: [], total: 0, homuraFree: true }];
    }
    return super.validTributeSets(playerIndex, witchCard);
  }

  summon(playerIndex, cardId, tributeRefs = []) {
    if (!this._homuraExtraWitchAvailable(playerIndex, cardId)) {
      return super.summon(playerIndex, cardId, tributeRefs);
    }

    this.ensurePriority(playerIndex);
    if (tributeRefs.length) throw new Error('ほむらの追加召喚に生贄は必要ありません。');
    const player = this.player(playerIndex);
    const handIndex = player.hand.findIndex(card => card.id === cardId && card.type === CARD_TYPES.WITCH);
    const destination = player.field.indexOf(null);
    if (handIndex < 0 || destination < 0) throw new Error('ほむらの追加召喚は行えません。');

    const [summoned] = player.hand.splice(handIndex, 1);
    player.field[destination] = summoned;
    summoned.attackedTurn = null;
    this.state.homuraExtraWitchSummon = null;
    this.emit('summon', {
      player: playerIndex,
      slot: destination,
      card: { ...summoned },
      tributes: [],
      special: 'homura',
      free: true,
    });
    this.log(`${player.name}の必殺技で${summoned.name}を生贄なしで追加召喚`);
    this.state.priorityPlayer = playerIndex;
    return destination;
  }

  activateSpecial(playerIndex) {
    const isHomura = this.player(playerIndex).character?.id === 'homura';
    const result = super.activateSpecial(playerIndex);
    if (isHomura && this.state.phase !== PHASES.GAME_OVER) {
      this.state.homuraExtraWitchSummon = { player: playerIndex, turn: this.state.turn };
      if (this._homuraExtraWitchAvailable(playerIndex)) {
        this.log(`${this.player(playerIndex).name}は戦闘前に手札の魔女1体を生贄なしで追加召喚できる`);
      }
    }
    return result;
  }

  continueBattlePhase(playerIndex) {
    const result = super.continueBattlePhase(playerIndex);
    const marker = this.state.homuraExtraWitchSummon;
    if (marker?.player === playerIndex && marker.turn === this.state.turn) this.state.homuraExtraWitchSummon = null;
    return result;
  }

  respondChain(playerIndex, cardId = null) {
    const decision = this.state.pendingDecision;
    const player = this.player(playerIndex);
    const card = cardId ? player.hand.find(item => item.id === cardId) : null;
    const firstOwnTurnBoost = !!card
      && decision?.type === 'CHAIN_RESPONSE'
      && decision.player === playerIndex
      && decision.options.includes(cardId)
      && player.character?.id === 'homura'
      && this.state.activePlayer === playerIndex
      && card.effect === 'boost'
      && this.state.homuraBoostPassiveTurn !== this.state.turn;

    if (firstOwnTurnBoost) {
      this.state.homuraBoostPassiveTurn = this.state.turn;
      this.state.homuraBoostPassiveCardId = card.id;
    }
    return super.respondChain(playerIndex, cardId);
  }

  resolveMagic(playerIndex, card) {
    if (card?.effect === 'nullifyDamage' && this.state.battle) {
      this.state.battle.shieldPreventsBattleDestruction = true;
    }

    const empowered = card?.effect === 'boost'
      && this.player(playerIndex).character?.id === 'homura'
      && this.state.activePlayer === playerIndex
      && this.state.homuraBoostPassiveTurn === this.state.turn
      && this.state.homuraBoostPassiveCardId === card.id;
    if (!empowered) return super.resolveMagic(playerIndex, card);

    const originalValue = card.value ?? 0;
    card.value = originalValue + 2;
    this.log(`${this.player(playerIndex).name}のパッシブで${card.name}の上昇値を+2`);
    try {
      return super.resolveMagic(playerIndex, card);
    } finally {
      card.value = originalValue;
    }
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
