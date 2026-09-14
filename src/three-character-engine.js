import { GameEngine as BaseGameEngine, PHASES, CARD_TYPES } from './game-engine.js';

export { PHASES, CARD_TYPES };

export class GameEngine extends BaseGameEngine {
  _sayakaEffectiveThreshold(playerIndex, witchCard) {
    const base = witchCard?.tributeThreshold ?? 0;
    return this.player(playerIndex).character?.id === 'sayaka' && witchCard?.type === CARD_TYPES.WITCH
      ? Math.max(0, base - 1)
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
    if (p.character?.id !== 'sayaka' || card?.type !== CARD_TYPES.WITCH) {
      return super.summon(playerIndex, cardId, tributeRefs);
    }

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

  canUseSpecial(playerIndex) {
    const p = this.player(playerIndex);
    if (p.character?.id !== 'sayaka') return super.canUseSpecial(playerIndex);
    if (this.state.phase !== PHASES.BATTLE_START || this.state.pendingDecision) return false;
    if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
    if (p.specialUsed) return false;
    return p.graveyard.length >= 3;
  }

  activateSpecial(playerIndex) {
    const p = this.player(playerIndex);
    if (p.character?.id !== 'sayaka') return super.activateSpecial(playerIndex);
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
}
