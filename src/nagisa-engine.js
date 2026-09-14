import { GameEngine as BaseGameEngine, PHASES, CARD_TYPES } from './three-character-engine.js';

export { PHASES, CARD_TYPES };

const isMonster = card => !!card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type);

export class GameEngine extends BaseGameEngine {
  nagisaMonsterSlots(playerIndex) {
    const opponentPlayer = this.opponent(playerIndex);
    return {
      own: this.player(playerIndex).field
        .map((card, slot) => isMonster(card) ? slot : null)
        .filter(slot => slot !== null),
      opponent: this.player(opponentPlayer).field
        .map((card, slot) => isMonster(card) ? slot : null)
        .filter(slot => slot !== null),
    };
  }

  nagisaAttackerOptions(playerIndex) {
    const opponentPlayer = this.opponent(playerIndex);
    const slots = this.nagisaMonsterSlots(playerIndex);
    const opponentFieldEmpty = slots.opponent.length === 0;
    const canAttack = (attackerPlayer, slot) => {
      const attacker = this.player(attackerPlayer).field[slot];
      if (!isMonster(attacker) || attacker.attackedTurn === this.state.turn) return false;
      const ownTargets = slots.own.filter(target => !(attackerPlayer === playerIndex && target === slot));
      const opponentTargets = slots.opponent.filter(target => !(attackerPlayer === opponentPlayer && target === slot));
      if (ownTargets.length || opponentTargets.length) return true;
      return attackerPlayer === playerIndex && opponentFieldEmpty;
    };

    return {
      own: slots.own.filter(slot => canAttack(playerIndex, slot)),
      opponent: slots.opponent.filter(slot => canAttack(opponentPlayer, slot)),
    };
  }

  canUseSpecial(playerIndex) {
    const p = this.player(playerIndex);
    if (p.character?.id !== 'nagisa') return super.canUseSpecial(playerIndex);
    if (this.state.phase !== PHASES.BATTLE_START || this.state.pendingDecision) return false;
    if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
    if (p.specialUsed) return false;
    const options = this.nagisaAttackerOptions(playerIndex);
    return options.own.length + options.opponent.length > 0;
  }

  activateSpecial(playerIndex) {
    const p = this.player(playerIndex);
    if (p.character?.id !== 'nagisa') return super.activateSpecial(playerIndex);
    this.ensurePriority(playerIndex);
    if (!this.canUseSpecial(playerIndex)) throw new Error('Special move cannot be activated.');

    p.specialUsed = true;
    this.state.nagisaSpecial = { player: playerIndex, active: true };
    this.emit('special', { player: playerIndex, character: p.character.id });
    this.log(`${p.name}「強制戦闘」— 場の全モンスターを操作可能`);
    this._openNagisaAttackerDecision(playerIndex);
  }

  _openNagisaAttackerDecision(playerIndex) {
    if (this.state.phase === PHASES.GAME_OVER) return;
    const special = this.state.nagisaSpecial;
    if (!special?.active || special.player !== playerIndex) throw new Error('Nagisa forced battle is not active.');
    const options = this.nagisaAttackerOptions(playerIndex);
    if (options.own.length + options.opponent.length === 0) {
      this._finishNagisaSpecial(playerIndex, '操作できるモンスターがなくなった');
      return;
    }
    this.setPhase(PHASES.BATTLE_START);
    this.state.priorityPlayer = playerIndex;
    this.state.pendingDecision = {
      type: 'NAGISA_ATTACKER',
      player: playerIndex,
      opponentPlayer: this.opponent(playerIndex),
      ownOptions: options.own,
      opponentOptions: options.opponent,
      allowEnd: true,
    };
  }

  endNagisaSpecial(playerIndex) {
    const d = this.state.pendingDecision;
    const special = this.state.nagisaSpecial;
    if (!special?.active || special.player !== playerIndex || !d || d.type !== 'NAGISA_ATTACKER' || d.player !== playerIndex) {
      throw new Error('Nagisa forced battle cannot be ended now.');
    }
    this.state.pendingDecision = null;
    this._finishNagisaSpecial(playerIndex, 'なぎさが強制戦闘を終了した');
  }

  selectNagisaAttacker(playerIndex, attackerSide, attackerSlot) {
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'NAGISA_ATTACKER' || d.player !== playerIndex) {
      throw new Error('Invalid Nagisa attacker target.');
    }
    const attackerPlayer = attackerSide === 'self' ? playerIndex
      : attackerSide === 'opponent' ? d.opponentPlayer
      : null;
    const allowed = attackerSide === 'self' ? d.ownOptions
      : attackerSide === 'opponent' ? d.opponentOptions
      : [];
    if (attackerPlayer === null || !allowed.includes(attackerSlot)) throw new Error('Invalid Nagisa attacker target.');

    const attacker = this.player(attackerPlayer).field[attackerSlot];
    if (!isMonster(attacker) || attacker.attackedTurn === this.state.turn) {
      throw new Error('Nagisa attacker target is no longer available.');
    }

    const ownTargets = this.player(playerIndex).field
      .map((card, slot) => isMonster(card) && !(attackerPlayer === playerIndex && slot === attackerSlot) ? slot : null)
      .filter(slot => slot !== null);
    const opponentTargets = this.player(d.opponentPlayer).field
      .map((card, slot) => isMonster(card) && !(attackerPlayer === d.opponentPlayer && slot === attackerSlot) ? slot : null)
      .filter(slot => slot !== null);
    const directAllowed = attackerPlayer === playerIndex
      && this.nagisaMonsterSlots(playerIndex).opponent.length === 0;

    if (!ownTargets.length && !opponentTargets.length && !directAllowed) {
      throw new Error('The selected monster has no legal forced-battle target.');
    }

    this.state.pendingDecision = {
      type: 'NAGISA_TARGET',
      player: playerIndex,
      opponentPlayer: d.opponentPlayer,
      attackerPlayer,
      attackerSide,
      attackerSlot,
      attackerCardId: attacker.id,
      opponentTargets,
      ownTargets,
      directAllowed,
    };
    this.log(`${this.player(playerIndex).name}は${attacker.name}を操作する`);
  }

  resolveNagisaForcedBattle(playerIndex, targetSide, targetSlot = null) {
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'NAGISA_TARGET' || d.player !== playerIndex) {
      throw new Error('No Nagisa forced battle is pending.');
    }
    const attacker = this.player(d.attackerPlayer).field[d.attackerSlot];
    if (!isMonster(attacker) || attacker.id !== d.attackerCardId || attacker.attackedTurn === this.state.turn) {
      throw new Error('Nagisa controlled attacker is no longer available.');
    }

    let defenderPlayer = d.opponentPlayer;
    let defenderSlot = null;
    let defender = null;
    let direct = false;

    if (targetSide === 'direct') {
      if (!d.directAllowed || targetSlot !== null || this.nagisaMonsterSlots(playerIndex).opponent.length !== 0) {
        throw new Error('Nagisa direct attack is not available while the opponent controls a monster.');
      }
      direct = true;
    } else if (targetSide === 'opponent') {
      if (!d.opponentTargets.includes(targetSlot)) throw new Error('Invalid Nagisa opponent target.');
      defenderSlot = targetSlot;
      defender = this.player(d.opponentPlayer).field[targetSlot];
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
      attackerPlayer: d.attackerPlayer,
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
      forcedAttackerProtected: false,
    };
    this.state.resumePhase = PHASES.BATTLE;
    this.state.chainPassCount = 0;

    if (direct) {
      this.log(`${this.player(playerIndex).name}「強制戦闘」— ${attacker.name}で直接攻撃`);
    } else {
      this.log(`${this.player(playerIndex).name}「強制戦闘」— ${attacker.name}に${defender.name}への攻撃を強制`);
    }
    this.emit('attack', { ...structuredClone(this.state.battle), special: 'nagisa' });
    this.beginChainWindow(playerIndex);
  }

  canActivateMagic(playerIndex, card) {
    const battle = this.state.battle;
    if (!battle?.nagisaForced) return super.canActivateMagic(playerIndex, card);
    if (playerIndex !== battle.forcedBy) return false;
    if (card.effect === 'boost') return true;
    if (card.effect === 'nullifyDamage') {
      return !battle.direct && isMonster(this.player(battle.attackerPlayer).field[battle.attackerSlot]);
    }
    return false;
  }

  beginChainWindow(playerIndex) {
    const battle = this.state.battle;
    if (!battle?.nagisaForced) return super.beginChainWindow(playerIndex);
    const forcedBy = battle.forcedBy;
    const options = this.activatableChainCards(forcedBy);
    this.setPhase(PHASES.CHAIN);
    this.state.priorityPlayer = forcedBy;
    if (!options.length) {
      this.resolveChainAndBattle();
      return;
    }
    this.state.pendingDecision = {
      type: 'CHAIN_RESPONSE',
      player: forcedBy,
      options: options.map(card => card.id),
      allowPass: true,
      nagisaForced: true,
    };
  }

  respondChain(playerIndex, cardId = null) {
    const battle = this.state.battle;
    if (!battle?.nagisaForced) return super.respondChain(playerIndex, cardId);
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'CHAIN_RESPONSE' || d.player !== playerIndex || playerIndex !== battle.forcedBy) {
      throw new Error('No Nagisa chain response is pending for this player.');
    }
    if (cardId && (!d.options.includes(cardId) || !this.player(playerIndex).hand.some(card => card.id === cardId))) {
      throw new Error('Card is not an available chain option.');
    }
    this.state.pendingDecision = null;

    if (!cardId) {
      this.resolveChainAndBattle();
      return;
    }

    const p = this.player(playerIndex);
    const idx = p.hand.findIndex(card => card.id === cardId);
    const [card] = p.hand.splice(idx, 1);
    this.state.chain.push({ player: playerIndex, card });
    this.log(`CHAIN ${this.state.chain.length}: ${p.name}が${card.name}を発動`);
    if (card.effect === 'nullifyDamage') {
      this.log(`${card.name}の発動でチェーン終了`);
      this.resolveChainAndBattle();
      return;
    }
    this.beginChainWindow(playerIndex);
  }

  resolveMagic(playerIndex, card) {
    const battle = this.state.battle;
    if (!battle?.nagisaForced) return super.resolveMagic(playerIndex, card);
    if (playerIndex !== battle.forcedBy) throw new Error('Only Nagisa can support a forced battle.');

    if (card.effect === 'boost') {
      battle.attackerBonus += card.value ?? 0;
    } else if (card.effect === 'nullifyDamage') {
      battle.forcedAttackerProtected = true;
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
    const attackerProtected = !!b.forcedAttackerProtected;
    const dealDamage = (playerIndex, rawDamage, direct) => {
      const damage = this.applyCharacterDamageReduction(playerIndex, rawDamage);
      this.log(`${this.player(playerIndex).name}に${direct ? '直接攻撃' : '戦闘'}ダメージ ${damage}`);
      this.emit('damage', { player: playerIndex, amount: damage, rawAmount: rawDamage, direct, forced: true });
      if (damage > 0) this.takeDeckDamage(playerIndex, damage);
    };

    if (b.direct) {
      dealDamage(b.defenderPlayer, attackValue, true);
    } else if (attackValue === defendValue) {
      if (!attackerProtected) this.destroy(b.attackerPlayer, b.attackerSlot, 'nagisa-forced-battle');
      this.destroy(b.defenderPlayer, b.defenderSlot, 'nagisa-forced-battle');
      this.log(`強制戦闘は同値で解決（${attackValue} - ${defendValue}）`);
    } else if (attackValue > defendValue) {
      this.destroy(b.defenderPlayer, b.defenderSlot, 'nagisa-forced-battle');
      dealDamage(b.defenderPlayer, attackValue - defendValue, false);
    } else if (attackerProtected) {
      this.log(`${this.player(b.forcedBy).name}は盾で操作中の${this.player(b.attackerPlayer).field[b.attackerSlot]?.name ?? 'モンスター'}を守った`);
    } else {
      this.destroy(b.attackerPlayer, b.attackerSlot, 'nagisa-forced-battle');
      dealDamage(b.attackerPlayer, defendValue - attackValue, false);
    }

    this.emit('battleEnd', { ...structuredClone(b), attackValue, defendValue });
    const forcedBy = b.forcedBy;
    const endSpecial = !!b.endBattlePhase;
    this.state.battle = null;
    this.state.chain = [];
    this.state.chainPassCount = 0;
    this.state.resumePhase = null;
    this.state.battlePhaseEnded = false;

    if (this.state.phase !== PHASES.GAME_OVER) {
      if (endSpecial) {
        this._finishNagisaSpecial(forcedBy, '盾の効果で強制戦闘を終了した');
      } else {
        this._openNagisaAttackerDecision(forcedBy);
      }
    }
  }

  _finishNagisaSpecial(playerIndex, reason) {
    this.state.nagisaSpecial = null;
    this.state.pendingDecision = null;
    if (this.state.phase === PHASES.GAME_OVER) return;
    this.log(`${this.player(playerIndex).name}の強制戦闘が終了：${reason}`);
    this._advanceTurn(playerIndex);
  }
}
