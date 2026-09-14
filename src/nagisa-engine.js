import { GameEngine as BaseGameEngine, PHASES, CARD_TYPES } from './three-character-engine.js';

export { PHASES, CARD_TYPES };

const isMonster = card => !!card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type);

export class GameEngine extends BaseGameEngine {
  nagisaOpponentMonsterSlots(playerIndex) {
    return this.player(this.opponent(playerIndex)).field
      .map((card, slot) => isMonster(card) ? slot : null)
      .filter(slot => slot !== null);
  }

  canUseSpecial(playerIndex) {
    const p = this.player(playerIndex);
    if (p.character?.id !== 'nagisa') return super.canUseSpecial(playerIndex);
    if (this.state.phase !== PHASES.BATTLE_START || this.state.pendingDecision) return false;
    if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
    if (p.specialUsed) return false;
    return this.nagisaOpponentMonsterSlots(playerIndex).length > 0;
  }

  activateSpecial(playerIndex) {
    const p = this.player(playerIndex);
    if (p.character?.id !== 'nagisa') return super.activateSpecial(playerIndex);
    this.ensurePriority(playerIndex);
    if (!this.canUseSpecial(playerIndex)) throw new Error('Special move cannot be activated.');

    p.specialUsed = true;
    this.emit('special', { player: playerIndex, character: p.character.id });
    this.state.pendingDecision = {
      type: 'NAGISA_ATTACKER',
      player: playerIndex,
      opponentPlayer: this.opponent(playerIndex),
      options: this.nagisaOpponentMonsterSlots(playerIndex),
    };
    this.log(`${p.name}「強制戦闘」— 操る相手の使い魔・魔女を選択`);
  }

  selectNagisaAttacker(playerIndex, opponentSlot) {
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'NAGISA_ATTACKER' || d.player !== playerIndex || !d.options.includes(opponentSlot)) {
      throw new Error('Invalid Nagisa attacker target.');
    }
    const opponent = this.player(d.opponentPlayer);
    const attacker = opponent.field[opponentSlot];
    if (!isMonster(attacker)) throw new Error('Nagisa attacker target is no longer available.');

    const opponentTargets = opponent.field
      .map((card, slot) => slot !== opponentSlot && isMonster(card) ? slot : null)
      .filter(slot => slot !== null);
    const ownTargets = this.player(playerIndex).field
      .map((card, slot) => isMonster(card) ? slot : null)
      .filter(slot => slot !== null);

    this.state.pendingDecision = {
      type: 'NAGISA_TARGET',
      player: playerIndex,
      opponentPlayer: d.opponentPlayer,
      attackerSlot: opponentSlot,
      attackerCardId: attacker.id,
      opponentTargets,
      ownTargets,
      directAllowed: opponentTargets.length === 0,
    };
    this.log(`${this.player(playerIndex).name}は${attacker.name}を操る対象に選択`);
  }

  resolveNagisaForcedBattle(playerIndex, targetSide, targetSlot = null) {
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'NAGISA_TARGET' || d.player !== playerIndex) {
      throw new Error('No Nagisa forced battle is pending.');
    }
    const opponent = this.player(d.opponentPlayer);
    const attacker = opponent.field[d.attackerSlot];
    if (!isMonster(attacker) || attacker.id !== d.attackerCardId) {
      throw new Error('Nagisa controlled attacker is no longer available.');
    }

    let defenderPlayer = d.opponentPlayer;
    let defenderSlot = null;
    let defender = null;
    let direct = false;

    if (targetSide === 'direct') {
      if (!d.directAllowed || targetSlot !== null) throw new Error('Nagisa direct attack is not available.');
      direct = true;
    } else if (targetSide === 'opponent') {
      if (!d.opponentTargets.includes(targetSlot)) throw new Error('Invalid Nagisa opponent target.');
      defenderSlot = targetSlot;
      defender = opponent.field[targetSlot];
      if (!isMonster(defender)) throw new Error('Nagisa opponent target is no longer available.');
    } else if (targetSide === 'self') {
      if (!d.ownTargets.includes(targetSlot)) throw new Error('Invalid Nagisa own target.');
      defenderPlayer = playerIndex;
      defenderSlot = targetSlot;
      defender = this.player(playerIndex).field[targetSlot];
      if (!isMonster(defender)) throw new Error('Nagisa own target is no longer available.');
    } else {
      throw new Error('Invalid Nagisa forced battle target side.');
    }

    this.state.pendingDecision = null;
    attacker.attackedTurn = this.state.turn;
    this.state.battle = {
      attackerPlayer: d.opponentPlayer,
      attackerSlot: d.attackerSlot,
      defenderPlayer,
      defenderSlot,
      direct,
      attackerBase: attacker.attack ?? 0,
      defenderBase: defender?.attack ?? 0,
      attackerBonus: 0,
      defenderBonus: 0,
      damagePrevented: [false, false],
      endBattlePhase: false,
      nagisaForced: true,
      forcedBy: playerIndex,
      forcedTargetSide: targetSide,
      forcedDefenderProtected: false,
    };
    this.state.resumePhase = PHASES.BATTLE;
    this.state.chainPassCount = 0;

    if (direct) {
      this.log(`${this.player(playerIndex).name}「強制戦闘」— ${attacker.name}に持ち主への直接攻撃を強制`);
    } else {
      this.log(`${this.player(playerIndex).name}「強制戦闘」— ${attacker.name}に${defender.name}への攻撃を強制`);
    }
    this.emit('attack', { ...structuredClone(this.state.battle), special: 'nagisa' });
    this.beginChainWindow(d.opponentPlayer);
  }

  canActivateMagic(playerIndex, card) {
    const battle = this.state.battle;
    if (!battle?.nagisaForced) return super.canActivateMagic(playerIndex, card);
    if (battle.direct || playerIndex !== battle.defenderPlayer) return false;
    if (card.effect === 'boost') return true;
    if (card.effect === 'nullifyDamage') return isMonster(this.player(battle.defenderPlayer).field[battle.defenderSlot]);
    return false;
  }

  resolveMagic(playerIndex, card) {
    const battle = this.state.battle;
    if (!battle?.nagisaForced) return super.resolveMagic(playerIndex, card);
    if (playerIndex !== battle.defenderPlayer) throw new Error('The controlled attacker cannot receive chain support.');

    if (card.effect === 'boost') {
      battle.defenderBonus += card.value ?? 0;
    } else if (card.effect === 'nullifyDamage') {
      battle.forcedDefenderProtected = true;
      battle.endBattlePhase = true;
    }
    this.player(playerIndex).graveyard.push(card);
    this.emit('magic', { player: playerIndex, card: { ...card } });
  }

  resolveBattle() {
    const b = this.state.battle;
    if (!b?.nagisaForced) return super.resolveBattle();

    const attackValue = b.attackerBase + b.attackerBonus;
    const defendValue = b.defenderBase + b.defenderBonus;
    const defenderProtected = !!b.forcedDefenderProtected;
    const dealDamage = (playerIndex, rawDamage, direct) => {
      const damage = this.applyCharacterDamageReduction(playerIndex, rawDamage);
      this.log(`${this.player(playerIndex).name}に${direct ? '直接攻撃' : '戦闘'}ダメージ ${damage}`);
      this.emit('damage', { player: playerIndex, amount: damage, rawAmount: rawDamage, direct, forced: true });
      if (damage > 0) this.takeDeckDamage(playerIndex, damage);
    };

    if (b.direct) {
      dealDamage(b.defenderPlayer, attackValue, true);
    } else if (attackValue === defendValue) {
      this.destroy(b.attackerPlayer, b.attackerSlot, 'nagisa-forced-battle');
      if (!defenderProtected) this.destroy(b.defenderPlayer, b.defenderSlot, 'nagisa-forced-battle');
      this.log(`強制戦闘は同値で解決（${attackValue} - ${defendValue}）`);
    } else if (attackValue > defendValue) {
      if (!defenderProtected) {
        this.destroy(b.defenderPlayer, b.defenderSlot, 'nagisa-forced-battle');
        dealDamage(b.defenderPlayer, attackValue - defendValue, false);
      } else {
        this.log(`${this.player(b.defenderPlayer).name}は盾で強制戦闘の破壊とダメージを防いだ`);
      }
    } else {
      this.destroy(b.attackerPlayer, b.attackerSlot, 'nagisa-forced-battle');
      dealDamage(b.attackerPlayer, defendValue - attackValue, false);
    }

    this.emit('battleEnd', { ...structuredClone(b), attackValue, defendValue });
    const forcedBy = b.forcedBy;
    this.state.battle = null;
    this.state.chainPassCount = 0;
    this.state.resumePhase = null;
    this.state.battlePhaseEnded = false;

    if (this.state.phase !== PHASES.GAME_OVER) {
      this.log(`${this.player(forcedBy).name}の強制戦闘が終了`);
      this._advanceTurn(forcedBy);
    }
  }
}
