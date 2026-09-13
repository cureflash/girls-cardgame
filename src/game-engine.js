export const PHASES = Object.freeze({
  MAIN: 'MAIN',
  BATTLE_START: 'BATTLE_START',
  BATTLE: 'BATTLE',
  CHAIN: 'CHAIN',
  GAME_OVER: 'GAME_OVER',
});
export const CARD_TYPES = Object.freeze({ FAMILIAR: 'familiar', WITCH: 'witch', MAGIC: 'magic' });

function cloneCard(card) {
  return { ...card };
}

export class GameEngine {
  constructor({ players, decks, openingHand = 5, rng = Math.random }) {
    if (!players || players.length !== 2) throw new Error('Exactly two players are required.');
    this.rng = rng;
    this.state = {
      turn: 1,
      activePlayer: 0,
      priorityPlayer: 0,
      phase: PHASES.MAIN,
      pendingDecision: null,
      chain: [],
      chainPassCount: 0,
      resumePhase: null,
      battle: null,
      logs: [],
      winner: null,
      players: players.map((p, i) => ({
        id: p.id,
        name: p.name,
        character: p.character,
        deck: this.shuffle((decks[i] || []).map(cloneCard)),
        hand: [],
        field: Array(5).fill(null),
        graveyard: [],
      })),
    };

    this.state.players.forEach((p, i) => {
      const bonus = p.character?.id === 'mami' ? 1 : 0;
      this.draw(i, openingHand + bonus, { log: false });
    });
    this.log('デュエル開始');
    this.openPriorityWindow();
  }

  shuffle(cards) {
    const a = [...cards];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  player(index) { return this.state.players[index]; }
  opponent(index) { return 1 - index; }
  log(message) { this.state.logs.push(message); }

  draw(playerIndex, count = 1, { log = true } = {}) {
    const p = this.player(playerIndex);
    for (let i = 0; i < count; i++) {
      if (p.deck.length === 0) {
        this.endGame(this.opponent(playerIndex), `${p.name}のデッキが尽きた`);
        return;
      }
      p.hand.push(p.deck.shift());
    }
    if (log) this.log(`${p.name}が${count}枚ドロー`);
  }

  ensurePriority(playerIndex) {
    if (this.state.phase === PHASES.GAME_OVER) throw new Error('Game is over.');
    if (this.state.pendingDecision) throw new Error('A decision is pending.');
    if (this.state.priorityPlayer !== playerIndex) throw new Error('Player does not have priority.');
  }

  canSummon(playerIndex, cardId) {
    if (this.state.phase !== PHASES.MAIN || this.state.pendingDecision) return false;
    if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
    const p = this.player(playerIndex);
    const card = p.hand.find(c => c.id === cardId);
    if (!card || ![CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type)) return false;
    if (!p.field.includes(null)) return false;
    if (card.type === CARD_TYPES.FAMILIAR) return true;
    return this.validTributeSets(playerIndex, card).length > 0;
  }

  validTributeSets(playerIndex, witchCard) {
    const fieldCards = this.player(playerIndex).field
      .map((card, slot) => ({ card, slot }))
      .filter(x => x.card?.type === CARD_TYPES.FAMILIAR);
    const threshold = witchCard.tributeThreshold ?? 0;
    const results = [];
    const n = fieldCards.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      const chosen = [];
      let total = 0;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          chosen.push(fieldCards[i].slot);
          total += fieldCards[i].card.attack ?? 0;
        }
      }
      if (total >= threshold) results.push({ slots: chosen, total });
    }
    return results.sort((a, b) => a.total - b.total || a.slots.length - b.slots.length);
  }

  summon(playerIndex, cardId, tributeSlots = []) {
    this.ensurePriority(playerIndex);
    if (!this.canSummon(playerIndex, cardId)) throw new Error('Card cannot be summoned in the current state.');
    const p = this.player(playerIndex);
    const handIndex = p.hand.findIndex(c => c.id === cardId);
    const card = p.hand[handIndex];
    const emptySlot = p.field.indexOf(null);
    if (emptySlot < 0) throw new Error('Monster zones are full.');

    if (card.type === CARD_TYPES.WITCH) {
      const unique = [...new Set(tributeSlots)];
      const tributes = unique.map(slot => p.field[slot]);
      if (tributes.some(c => !c || c.type !== CARD_TYPES.FAMILIAR)) throw new Error('Witches require familiar tributes.');
      const total = tributes.reduce((sum, c) => sum + (c.attack ?? 0), 0);
      if (total < (card.tributeThreshold ?? 0)) throw new Error('Tribute attack is below threshold.');
      unique.forEach(slot => {
        p.graveyard.push(p.field[slot]);
        p.field[slot] = null;
      });
      this.log(`${p.name}は使い魔を生贄にした（合計攻撃値 ${total}）`);
    }

    p.hand.splice(handIndex, 1);
    const destination = p.field.indexOf(null);
    p.field[destination] = card;
    this.log(`${p.name}が${card.name}を召喚`);
    this.passPriorityTo(this.opponent(playerIndex));
    return destination;
  }

  canActivateMainMagic(playerIndex, cardId) {
    if (this.state.phase !== PHASES.MAIN || this.state.pendingDecision) return false;
    if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
    const card = this.player(playerIndex).hand.find(c => c.id === cardId);
    return card?.type === CARD_TYPES.MAGIC && card.effect === 'draw';
  }

  activateMainMagic(playerIndex, cardId) {
    this.ensurePriority(playerIndex);
    if (!this.canActivateMainMagic(playerIndex, cardId)) throw new Error('This magic cannot be activated now.');
    const p = this.player(playerIndex);
    const index = p.hand.findIndex(c => c.id === cardId);
    const [card] = p.hand.splice(index, 1);
    p.graveyard.push(card);
    this.log(`${p.name}が${card.name}を発動`);
    this.draw(playerIndex, card.value ?? 0);
    if (this.state.phase !== PHASES.GAME_OVER) this.passPriorityTo(this.opponent(playerIndex));
  }

  canEnterBattlePhase(playerIndex) {
    return this.state.phase === PHASES.MAIN
      && !this.state.pendingDecision
      && this.state.activePlayer === playerIndex
      && this.state.priorityPlayer === playerIndex;
  }

  enterBattlePhase(playerIndex) {
    this.ensurePriority(playerIndex);
    if (!this.canEnterBattlePhase(playerIndex)) throw new Error('Battle phase cannot be entered now.');
    this.state.phase = PHASES.BATTLE_START;
    this.state.priorityPlayer = playerIndex;
    this.log(`${this.player(playerIndex).name}がバトルフェイズ開始時へ`);
    this.openPriorityWindow();
  }

  canContinueBattlePhase(playerIndex) {
    return this.state.phase === PHASES.BATTLE_START
      && !this.state.pendingDecision
      && this.state.activePlayer === playerIndex
      && this.state.priorityPlayer === playerIndex;
  }

  continueBattlePhase(playerIndex) {
    this.ensurePriority(playerIndex);
    if (!this.canContinueBattlePhase(playerIndex)) throw new Error('Battle phase cannot continue now.');
    this.state.phase = PHASES.BATTLE;
    this.state.priorityPlayer = playerIndex;
    this.log(`${this.player(playerIndex).name}のバトルフェイズ`);
    this.openPriorityWindow();
  }

  canAttack(playerIndex, attackerSlot, targetSlot) {
    if (this.state.phase !== PHASES.BATTLE || this.state.pendingDecision) return false;
    if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
    if (this.state.turn === 1 && playerIndex === 0) return false;
    const attacker = this.player(playerIndex).field[attackerSlot];
    const defender = this.player(this.opponent(playerIndex)).field[targetSlot];
    return !!attacker && !!defender;
  }

  attack(playerIndex, attackerSlot, targetSlot) {
    this.ensurePriority(playerIndex);
    if (!this.canAttack(playerIndex, attackerSlot, targetSlot)) throw new Error('Attack is not legal in the current state.');
    const attacker = this.player(playerIndex).field[attackerSlot];
    const defender = this.player(this.opponent(playerIndex)).field[targetSlot];

    this.state.battle = {
      attackerPlayer: playerIndex,
      attackerSlot,
      defenderPlayer: this.opponent(playerIndex),
      defenderSlot: targetSlot,
      attackerBase: attacker.attack ?? 0,
      defenderBase: defender.attack ?? 0,
      attackerBonus: 0,
      defenderBonus: 0,
      damageNullifiedFor: null,
    };
    this.state.resumePhase = PHASES.BATTLE;
    this.log(`${attacker.name}が${defender.name}を攻撃`);
    this.state.chainPassCount = 0;
    this.beginChainWindow(playerIndex);
  }

  activatableChainCards(playerIndex) {
    const p = this.player(playerIndex);
    if (!this.state.battle) return [];
    return p.hand.filter(card => card.type === CARD_TYPES.MAGIC && card.chainable && this.canActivateMagic(playerIndex, card));
  }

  canActivateMagic(playerIndex, card) {
    if (card.effect === 'boost') return !!this.state.battle;
    if (card.effect === 'nullifyDamage') return !!this.state.battle;
    return false;
  }

  beginChainWindow(playerIndex) {
    const options = this.activatableChainCards(playerIndex);
    this.state.phase = PHASES.CHAIN;
    this.state.priorityPlayer = playerIndex;

    if (options.length === 0) {
      this.state.chainPassCount = (this.state.chainPassCount ?? 0) + 1;
      if (this.state.chainPassCount >= 2) {
        this.resolveChainAndBattle();
      } else {
        this.beginChainWindow(this.opponent(playerIndex));
      }
      return;
    }

    this.state.pendingDecision = {
      type: 'CHAIN_RESPONSE',
      player: playerIndex,
      options: options.map(c => c.id),
      allowPass: true,
    };
  }

  respondChain(playerIndex, cardId = null) {
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'CHAIN_RESPONSE' || d.player !== playerIndex) throw new Error('No chain response is pending for this player.');
    this.state.pendingDecision = null;

    if (!cardId) {
      this.state.chainPassCount = (this.state.chainPassCount ?? 0) + 1;
      if (this.state.chainPassCount >= 2) this.resolveChainAndBattle();
      else this.beginChainWindow(this.opponent(playerIndex));
      return;
    }

    const p = this.player(playerIndex);
    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx < 0 || !d.options.includes(cardId)) throw new Error('Card is not an available chain option.');
    const card = p.hand.splice(idx, 1)[0];
    this.state.chain.push({ player: playerIndex, card });
    this.state.chainPassCount = 0;
    this.log(`CHAIN ${this.state.chain.length}: ${p.name}が${card.name}を発動`);
    this.beginChainWindow(this.opponent(playerIndex));
  }

  resolveChainAndBattle() {
    this.state.pendingDecision = null;
    while (this.state.chain.length) {
      const item = this.state.chain.pop();
      this.resolveMagic(item.player, item.card);
    }
    this.state.phase = this.state.resumePhase ?? PHASES.BATTLE;
    if (this.state.battle) this.resolveBattle();
  }

  resolveMagic(playerIndex, card) {
    const battle = this.state.battle;
    if (!battle) return;
    if (card.effect === 'boost') {
      if (playerIndex === battle.attackerPlayer) battle.attackerBonus += card.value ?? 0;
      else if (playerIndex === battle.defenderPlayer) battle.defenderBonus += card.value ?? 0;
    } else if (card.effect === 'nullifyDamage') {
      battle.damageNullifiedFor = playerIndex;
    }
    this.player(playerIndex).graveyard.push(card);
  }

  resolveBattle() {
    const b = this.state.battle;
    const attackValue = b.attackerBase + b.attackerBonus;
    const defendValue = b.defenderBase + b.defenderBonus;

    if (attackValue === defendValue) {
      this.log(`戦闘は引き分け（${attackValue} - ${defendValue}）`);
    } else {
      const loserPlayer = attackValue > defendValue ? b.defenderPlayer : b.attackerPlayer;
      const loserSlot = attackValue > defendValue ? b.defenderSlot : b.attackerSlot;
      const rawDamage = Math.max(attackValue, defendValue) - Math.min(attackValue, defendValue);
      const loserCard = this.player(loserPlayer).field[loserSlot];
      if (loserCard) {
        this.player(loserPlayer).graveyard.push(loserCard);
        this.player(loserPlayer).field[loserSlot] = null;
      }
      const damage = b.damageNullifiedFor === loserPlayer ? 0 : this.applyCharacterDamageReduction(loserPlayer, rawDamage);
      this.log(`${this.player(loserPlayer).name}が戦闘に敗北（ダメージ ${damage}）`);
      if (damage > 0) this.takeDeckDamage(loserPlayer, damage);
    }

    this.state.battle = null;
    this.state.chainPassCount = 0;
    this.state.resumePhase = null;
    if (this.state.phase !== PHASES.GAME_OVER) {
      this.state.phase = PHASES.BATTLE;
      this.openPriorityWindow();
    }
  }

  applyCharacterDamageReduction(playerIndex, damage) {
    return this.player(playerIndex).character?.id === 'madoka' ? Math.max(0, damage - 1) : damage;
  }

  takeDeckDamage(playerIndex, damage) {
    const p = this.player(playerIndex);
    const revealed = [];
    for (let i = 0; i < damage; i++) {
      if (p.deck.length === 0) {
        this.endGame(this.opponent(playerIndex), `${p.name}のデッキが尽きた`);
        return;
      }
      revealed.push(p.deck.shift());
    }
    const toHandCount = Math.ceil(damage / 3);
    const toHand = revealed.slice(0, toHandCount);
    const toGrave = revealed.slice(toHandCount);
    p.hand.push(...toHand);
    p.graveyard.push(...toGrave);
    this.log(`${p.name}: ${damage}枚めくり、${toHand.length}枚を手札、${toGrave.length}枚を墓地へ`);
    if (p.deck.length === 0) this.endGame(this.opponent(playerIndex), `${p.name}のデッキが尽きた`);
  }

  canUseSpecial(playerIndex) {
    if (this.state.phase !== PHASES.BATTLE_START || this.state.pendingDecision) return false;
    if (this.state.activePlayer !== playerIndex || this.state.priorityPlayer !== playerIndex) return false;
    const p = this.player(playerIndex);
    if (p.character?.id === 'madoka') {
      return p.field.includes(null) && p.graveyard.some(c => [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(c.type));
    }
    if (p.character?.id === 'mami') return true;
    return false;
  }

  activateSpecial(playerIndex) {
    this.ensurePriority(playerIndex);
    if (!this.canUseSpecial(playerIndex)) throw new Error('Special move cannot be activated.');
    const p = this.player(playerIndex);
    if (p.character.id === 'mami') {
      this.resolveTiroFinale(playerIndex);
      this._finishTurnAfterSpecial(playerIndex);
      return;
    }
    if (p.character.id === 'madoka') {
      this.state.pendingDecision = {
        type: 'MADOKA_REVIVE',
        player: playerIndex,
        options: p.graveyard.filter(c => [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(c.type)).map(c => c.id),
      };
    }
  }

  resolveTiroFinale(playerIndex) {
    this.state.players.forEach(p => {
      p.field.forEach((card, slot) => {
        if (card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type)) {
          p.graveyard.push(card);
          p.field[slot] = null;
        }
      });
    });
    this.log(`${this.player(playerIndex).name}「ティロ・フィナーレ」— 全モンスター破壊`);
  }

  selectReviveTarget(playerIndex, cardId) {
    const d = this.state.pendingDecision;
    if (!d || d.type !== 'MADOKA_REVIVE' || d.player !== playerIndex || !d.options.includes(cardId)) throw new Error('Invalid revive target.');
    const p = this.player(playerIndex);
    const idx = p.graveyard.findIndex(c => c.id === cardId);
    const slot = p.field.indexOf(null);
    if (idx < 0 || slot < 0) throw new Error('Revive is no longer possible.');
    const [card] = p.graveyard.splice(idx, 1);
    p.field[slot] = card;
    this.state.pendingDecision = null;
    this.log(`${p.name}「プルウィア☆マギカ」— ${card.name}を蘇生`);
    this._finishTurnAfterSpecial(playerIndex);
  }

  canEndTurn(playerIndex) {
    return !this.state.pendingDecision
      && this.state.activePlayer === playerIndex
      && this.state.priorityPlayer === playerIndex
      && [PHASES.MAIN, PHASES.BATTLE].includes(this.state.phase);
  }

  endTurn(playerIndex) {
    this.ensurePriority(playerIndex);
    if (!this.canEndTurn(playerIndex)) throw new Error('Turn cannot end in the current state.');
    this._advanceTurn(playerIndex);
  }

  _finishTurnAfterSpecial(playerIndex) {
    this.log(`${this.player(playerIndex).name}は必殺技を使ったためバトルフェイズをスキップ`);
    this._advanceTurn(playerIndex);
  }

  _advanceTurn(playerIndex) {
    if (this.state.activePlayer !== playerIndex) throw new Error('Only the active player can advance the turn.');
    this.state.pendingDecision = null;
    this.state.chain = [];
    this.state.chainPassCount = 0;
    this.state.battle = null;
    this.state.resumePhase = null;
    this.state.turn += 1;
    this.state.activePlayer = this.opponent(playerIndex);
    this.state.priorityPlayer = this.state.activePlayer;
    this.state.phase = PHASES.MAIN;
    this.draw(this.state.activePlayer, 1);
    if (this.state.phase !== PHASES.GAME_OVER) {
      this.log(`ターン${this.state.turn}: ${this.player(this.state.activePlayer).name}`);
      this.openPriorityWindow();
    }
  }

  passPriorityTo(playerIndex) {
    if (this.state.phase === PHASES.GAME_OVER) throw new Error('Game is over.');
    if (this.state.pendingDecision) throw new Error('A decision is pending.');
    this.state.priorityPlayer = playerIndex;
    this.openPriorityWindow();
  }

  openPriorityWindow() {
    if (this.state.phase === PHASES.GAME_OVER || this.state.pendingDecision) return;
  }

  endGame(winnerIndex, reason) {
    this.state.phase = PHASES.GAME_OVER;
    this.state.winner = winnerIndex;
    this.state.pendingDecision = null;
    this.state.resumePhase = null;
    this.log(`${this.player(winnerIndex).name}の勝利: ${reason}`);
  }
}
