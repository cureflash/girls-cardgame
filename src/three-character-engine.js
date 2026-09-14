import { GameEngine as BaseGameEngine, PHASES, CARD_TYPES } from './game-engine.js';

export { PHASES, CARD_TYPES };

export class GameEngine extends BaseGameEngine {
  constructor(options) {
    super(options);
    const openingHand = options?.openingHand ?? 5;
    this.state.players.forEach((p, i) => {
      const modifier = p.character?.openingHandModifier ?? 0;
      const desired = Math.max(0, openingHand + modifier);
      if (p.hand.length > desired) {
        const returned = p.hand.splice(desired);
        p.deck.unshift(...returned);
      } else if (p.hand.length < desired) {
        const needed = desired - p.hand.length;
        for (let n = 0; n < needed && p.deck.length; n++) p.hand.push(p.deck.shift());
      }
      const initialDraw = this.state.events.find(event => event.type === 'draw' && event.player === i);
      if (initialDraw) initialDraw.count = p.hand.length;
    });
  }

  _effectiveMonsterAttack(playerIndex, card) {
    return card?.attack ?? 0;
  }

  _sayakaEffectiveThreshold(playerIndex, witchCard) {
    const base = witchCard?.tributeThreshold ?? 0;
    return this.player(playerIndex).character?.id === 'sayaka' && witchCard?.type === CARD_TYPES.WITCH
      ? Math.max(0, base - 3)
      : base;
  }

  validTributeSets(playerIndex, witchCard) {
    if (this._sayakaSummonUsesDiscountedCard) return super.validTributeSets(playerIndex, witchCard);
    const threshold = this._sayakaEffectiveThreshold(playerIndex, witchCard);
    if (threshold === (witchCard?.tributeThreshold ?? 0)) return super.validTributeSets(playerIndex, witchCard);
    return super.validTributeSets(playerIndex, { ...witchCard, tributeThreshold: threshold });
  }

  summon(playerIndex, cardId, tributeRefs = []) {
    const p = this.player(playerIndex);
    const card = p.hand.find(item => item.id === cardId);
    if (p.character?.id === 'sayaka' && card?.type === CARD_TYPES.WITCH) {
      const originalThreshold = card.tributeThreshold ?? 0;
      card.tributeThreshold = this._sayakaEffectiveThreshold(playerIndex, card);
      this._sayakaSummonUsesDiscountedCard = true;
      try {
        return super.summon(playerIndex, cardId, tributeRefs);
      } finally {
        this._sayakaSummonUsesDiscountedCard = false;
        card.tributeThreshold = originalThreshold;
        for (let i = this.state.events.length - 1; i >= 0; i--) {
          const event = this.state.events[i];
          if (event.card?.id === cardId) {
            event.card.tributeThreshold = originalThreshold;
            break;
          }
        }
      }
    }

    return super.summon(playerIndex, cardId, tributeRefs);
  }

  _homuraChainLocked(playerIndex) {
    return this.state.homuraChainLockTurn === this.state.turn
      && this.state.homuraChainLockPlayer === playerIndex;
  }

  beginChainWindow(playerIndex) {
    if (!this._homuraChainLocked(playerIndex)) return super.beginChainWindow(playerIndex);
    this.setPhase(PHASES.CHAIN);
    this.state.priorityPlayer = playerIndex;
    this.state.chainPassCount = (this.state.chainPassCount ?? 0) + 1;
    if (this.state.chainPassCount >= 2) this.resolveChainAndBattle();
    else this.beginChainWindow(this.opponent(playerIndex));
  }

  _kyokoOwnTributeSets(playerIndex, witchCard, opponentAttack) {
    const p = this.player(playerIndex);
    const fieldCards = p.field
      .map((card, slot) => ({ card, slot }))
      .filter(item => item.card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(item.card.type));
    const handPlans = this._handTributePlans(playerIndex, witchCard);
    const threshold = witchCard?.tributeThreshold ?? 0;
    const results = [];
    const n = fieldCards.length;

    for (let mask = 0; mask < (1 << n); mask++) {
      const slots = [];
      let fieldTotal = 0;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          slots.push(fieldCards[i].slot);
          fieldTotal += fieldCards[i].card.attack ?? 0;
        }
      }
      if (!p.field.includes(null) && slots.length === 0) continue;
      const needed = Math.max(0, threshold - opponentAttack - fieldTotal);
      const handPlan = handPlans.find(plan => plan.total >= needed);
      if (!handPlan) continue;
      results.push({
        slots,
        handIds: handPlan.handIds,
        ownTotal: fieldTotal + handPlan.total,
        opponentTotal: opponentAttack,
        total: fieldTotal + handPlan.total + opponentAttack,
      });
    }

    return results.sort((a, b) => a.ownTotal - b.ownTotal
      || (a.slots.length + a.handIds.length) - (b.slots.length + b.handIds.length)
      || a.slots.length - b.slots.length);
  }

  validKyokoTributeSets(playerIndex, witchCard, opponentSlot) {
    const p = this.player(playerIndex);
    if (p.character?.id !== 'kyoko' || witchCard?.type !== CARD_TYPES.WITCH) return [];
    const opponentIndex = this.opponent(playerIndex);
    const opponent = this.player(opponentIndex);
    const target = opponent.field[opponentSlot];
    if (!target || ![CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(target.type)) return [];
    return this._kyokoOwnTributeSets(playerIndex, witchCard, this._effectiveMonsterAttack(opponentIndex, target));
  }

  kyokoSpecialTargets(playerIndex) {
    const p = this.player(playerIndex);
    if (p.character?.id !== 'kyoko') return [];
    const opponent = this.player(this.opponent(playerIndex));
    const witches = p.hand.filter(card => card.type === CARD_TYPES.WITCH);
    if (!witches.length) return [];
    const targets = [];
    for (let slot = 0; slot < opponent.field.length; slot++) {
      const target = opponent.field[slot];
      if (!target || ![CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(target.type)) continue;
      if (witches.some(witch => this.validKyokoTributeSets(playerIndex, witch, slot).length > 0)) targets.push(slot);
    }
    return targets;
  }

  canUseSpecial(playerIndex) {
    const p = this.player(playerIndex);
    if (p.character?.id === 'sayaka') {
      if (this.state.phase !== PHASES.BATTLE_START || this.state.pendingDecision) return false;
      if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
      if (p.specialUsed) return false;
      return p.graveyard.length >= 3;
    }
    if (p.character?.id === 'kyoko') {
      if (this.state.phase !== PHASES.BATTLE_START || this.state.pendingDecision) return false;
      if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
      if (p.specialUsed) return false;
      return this.kyokoSpecialTargets(playerIndex).length > 0;
    }
    if (p.character?.id === 'homura') {
      if (this.state.phase !== PHASES.BATTLE_START || this.state.pendingDecision) return false;
      if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
      return !p.specialUsed;
    }
    return super.canUseSpecial(playerIndex);
  }

  activateSpecial(playerIndex) {
    const p = this.player(playerIndex);
    if (p.character?.id === 'sayaka') {
      this.ensurePriority(playerIndex);
      if (!this.canUseSpecial(playerIndex)) throw new Error('Special move cannot be activated.');
      p.specialUsed = true;
      this.emit('special', { player: playerIndex, character: p.character.id });
      this.state.pendingDecision = {
        type: 'SAYAKA_RECYCLE',
        player: playerIndex,
        options: p.graveyard.map(card => card.id),
        selectedCards: [],
        required: 3,
      };
      this.log(`${p.name}の必殺技 — 墓地からデッキへ戻すカードを3枚選択`);
      return;
    }
    if (p.character?.id === 'kyoko') {
      this.ensurePriority(playerIndex);
      if (!this.canUseSpecial(playerIndex)) throw new Error('Special move cannot be activated.');
      p.specialUsed = true;
      this.emit('special', { player: playerIndex, character: p.character.id });
      this.state.pendingDecision = {
        type: 'KYOKO_OPPONENT_TRIBUTE',
        player: playerIndex,
        options: this.kyokoSpecialTargets(playerIndex),
      };
      this.log(`${p.name}の必殺技 — 相手の使い魔・魔女1体を生贄に選択`);
      return;
    }
    if (p.character?.id === 'homura') {
      this.ensurePriority(playerIndex);
      if (!this.canUseSpecial(playerIndex)) throw new Error('Special move cannot be activated.');
      p.specialUsed = true;
      this.state.homuraChainLockTurn = this.state.turn;
      this.state.homuraChainLockPlayer = this.opponent(playerIndex);
      this.emit('special', { player: playerIndex, character: p.character.id });
      this.log(`${p.name}の必殺技 — このターン、相手はチェーン不可`);
      return;
    }
    return super.activateSpecial(playerIndex);
  }

  selectRecycleTarget(playerIndex, cardId) {
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'SAYAKA_RECYCLE' || d.player !== playerIndex || !d.options.includes(cardId)) {
      throw new Error('Invalid recycle target.');
    }
    const p = this.player(playerIndex);
    const index = p.graveyard.findIndex(card => card.id === cardId);
    if (index < 0) throw new Error('Recycle target is no longer in the graveyard.');
    const [card] = p.graveyard.splice(index, 1);
    d.selectedCards.push(card);
    d.options = p.graveyard.map(item => item.id);
    this.emit('recycleSelect', { player: playerIndex, card: { ...card }, count: d.selectedCards.length });

    if (d.selectedCards.length < d.required) {
      this.log(`${p.name}は${card.name}を選択（${d.selectedCards.length}/${d.required}）`);
      return;
    }

    const returned = d.selectedCards;
    p.deck = this.shuffle([...p.deck, ...returned]);
    this.emit('recycle', { player: playerIndex, cards: returned.map(item => ({ ...item })), shuffled: true });
    this.state.pendingDecision = null;
    this.log(`${p.name}は墓地の3枚をデッキに戻してシャッフルした`);
    this._finishTurnAfterSpecial(playerIndex);
  }

  selectKyokoOpponentTribute(playerIndex, opponentSlot) {
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'KYOKO_OPPONENT_TRIBUTE' || d.player !== playerIndex || !d.options.includes(opponentSlot)) {
      throw new Error('Invalid Kyoko opponent tribute target.');
    }
    const opponentIndex = this.opponent(playerIndex);
    const target = this.player(opponentIndex).field[opponentSlot];
    if (!target || ![CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(target.type)) {
      throw new Error('Kyoko tribute target is no longer available.');
    }
    this.state.pendingDecision = {
      type: 'KYOKO_WITCH_SUMMON',
      player: playerIndex,
      opponentPlayer: opponentIndex,
      opponentSlot,
      opponentCardId: target.id,
    };
    this.log(`${this.player(playerIndex).name}は${target.name}を生贄に指定`);
  }

  resolveKyokoWitchSummon(playerIndex, witchId, ownFieldSlots = []) {
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'KYOKO_WITCH_SUMMON' || d.player !== playerIndex) {
      throw new Error('No Kyoko special summon is pending.');
    }
    const p = this.player(playerIndex);
    const opponent = this.player(d.opponentPlayer);
    const target = opponent.field[d.opponentSlot];
    if (!target || target.id !== d.opponentCardId || ![CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(target.type)) {
      throw new Error('Kyoko tribute target is no longer available.');
    }
    const witch = p.hand.find(card => card.id === witchId);
    if (!witch || witch.type !== CARD_TYPES.WITCH) throw new Error('Kyoko must summon a witch from hand.');
    const requested = [...new Set(ownFieldSlots)].sort((a, b) => a - b);
    const plan = this.validKyokoTributeSets(playerIndex, witch, d.opponentSlot)
      .find(candidate => candidate.slots.length === requested.length
        && candidate.slots.every((slot, index) => slot === requested[index]));
    if (!plan) throw new Error('Selected Kyoko tribute combination is invalid.');

    const opponentTributeValue = this._effectiveMonsterAttack(d.opponentPlayer, target);
    opponent.graveyard.push(target);
    opponent.field[d.opponentSlot] = null;
    this.emit('opponentTribute', {
      player: playerIndex,
      opponent: d.opponentPlayer,
      slot: d.opponentSlot,
      card: { ...target },
      value: opponentTributeValue,
    });

    for (const slot of plan.slots) {
      const tribute = p.field[slot];
      if (!tribute || ![CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(tribute.type)) throw new Error('Own field tribute disappeared.');
      p.graveyard.push(tribute);
      p.field[slot] = null;
    }
    for (const id of plan.handIds) {
      const index = p.hand.findIndex(card => card.id === id);
      const tribute = index >= 0 ? p.hand[index] : null;
      if (!tribute || tribute.type !== CARD_TYPES.FAMILIAR) throw new Error('Own hand tribute disappeared.');
      p.hand.splice(index, 1);
      p.graveyard.push(tribute);
    }

    const witchIndex = p.hand.findIndex(card => card.id === witchId);
    if (witchIndex < 0) throw new Error('Kyoko witch is no longer in hand.');
    const [summoned] = p.hand.splice(witchIndex, 1);
    const destination = p.field.indexOf(null);
    if (destination < 0) throw new Error('Monster zones are full.');
    p.field[destination] = summoned;
    summoned.attackedTurn = null;
    p.summonedThisTurn = true;
    this.emit('summon', {
      player: playerIndex,
      slot: destination,
      card: { ...summoned },
      tributes: [
        { zone: 'opponent-field', player: d.opponentPlayer, slot: d.opponentSlot, id: target.id },
        ...plan.slots.map(slot => ({ zone: 'field', slot })),
        ...plan.handIds.map(id => ({ zone: 'hand', id })),
      ],
      special: 'kyoko',
    });
    this.state.pendingDecision = null;
    this.log(`${p.name}は相手の${target.name}を含む生贄で${summoned.name}を召喚`);
    this._finishTurnAfterSpecial(playerIndex);
    return destination;
  }
}
