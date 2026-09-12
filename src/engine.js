import { RULES, CHARACTERS } from './config.js';
import { createDeck, shuffle, tributeCost, canBeSummoned, isSpadeBoost, isHeartRitual } from './cards.js';

let uidCounter = 1;
function withUid(card) {
  return { ...card, uid: `${card.id}-${uidCounter++}` };
}

export class GameEngine {
  constructor({ humanCharacter = 'madoka', aiCharacter = 'mami', rng = Math.random } = {}) {
    this.rng = rng;
    this.players = [
      this.makePlayer('human', humanCharacter),
      this.makePlayer('ai', aiCharacter),
    ];
    this.turn = 0;
    this.turnNumber = 1;
    this.currentPlayerIndex = 0;
    this.log = [];
    this.winner = null;
    this.battle = null;
    this.setup();
  }

  makePlayer(id, characterId) {
    if (!CHARACTERS[characterId]) throw new Error(`Unknown character: ${characterId}`);
    const deck = shuffle(createDeck(RULES.jokerCount), this.rng).map(withUid);
    return {
      id,
      characterId,
      character: CHARACTERS[characterId],
      deck,
      hand: [],
      field: [],
      grave: [],
      summonUsed: false,
      attacksUsed: 0,
    };
  }

  setup() {
    for (const player of this.players) {
      const bonus = player.characterId === 'mami' ? RULES.mamiInitialHandBonus : 0;
      this.draw(player, RULES.baseInitialHand + bonus, { loseOnEmpty: false });
    }
    this.logEvent(`${this.players[0].character.name} vs ${this.players[1].character.name} 開始`);
    this.startTurn(0);
  }

  get currentPlayer() { return this.players[this.currentPlayerIndex]; }
  get opponent() { return this.players[1 - this.currentPlayerIndex]; }

  startTurn(index) {
    if (this.winner) return;
    this.currentPlayerIndex = index;
    const player = this.currentPlayer;
    player.summonUsed = false;
    player.attacksUsed = 0;
    if (this.turn > 0) this.draw(player, 1);
    this.logEvent(`${player.character.name}のターン`);
  }

  endTurn() {
    if (this.winner || this.battle) return false;
    this.turn += 1;
    if (this.currentPlayerIndex === 1) this.turnNumber += 1;
    this.startTurn(1 - this.currentPlayerIndex);
    return true;
  }

  draw(player, count, { loseOnEmpty = true } = {}) {
    for (let i = 0; i < count; i += 1) {
      if (player.deck.length === 0) {
        if (loseOnEmpty) this.setLoser(player, 'デッキ切れ');
        return;
      }
      player.hand.push(player.deck.shift());
    }
  }

  normalSummon(player, handUid, tributeUids = []) {
    if (this.winner || player !== this.currentPlayer || player.summonUsed) return { ok: false, error: '召喚権がありません' };
    const card = player.hand.find((c) => c.uid === handUid);
    if (!canBeSummoned(card)) return { ok: false, error: '召喚できないカードです' };
    const cost = tributeCost(card);
    if (player.field.length - cost + 1 > RULES.fieldLimit) return { ok: false, error: '場が埋まっています' };
    const uniqueTributes = [...new Set(tributeUids)].filter((uid) => player.field.some((c) => c.uid === uid));
    if (uniqueTributes.length !== cost) return { ok: false, error: `生贄が${cost}枚必要です` };

    for (const uid of uniqueTributes) this.sendFieldToGrave(player, uid);
    this.removeFromHand(player, card.uid);
    player.field.push(card);
    player.summonUsed = true;
    this.logEvent(`${player.character.name}が${card.suitSymbol}${card.rank}を召喚`);
    return { ok: true };
  }

  ritualSummon(player, heartUid, targetUid) {
    if (this.winner || player !== this.currentPlayer || player.summonUsed) return { ok: false, error: '召喚権がありません' };
    if (player.field.length >= RULES.fieldLimit) return { ok: false, error: '場が埋まっています' };
    const heart = player.hand.find((c) => c.uid === heartUid);
    const target = player.hand.find((c) => c.uid === targetUid);
    if (!isHeartRitual(heart)) return { ok: false, error: 'ハートの数字カードを選んでください' };
    if (!canBeSummoned(target) || target.uid === heart.uid) return { ok: false, error: '召喚対象が不正です' };
    if (target.value >= heart.value) return { ok: false, error: '儀式カードより小さい数字だけ召喚できます' };

    this.removeFromHand(player, heart.uid);
    player.grave.push(heart);
    this.removeFromHand(player, target.uid);
    player.field.push(target);
    player.summonUsed = true;
    this.logEvent(`${player.character.name}が${heart.suitSymbol}${heart.rank}で${target.suitSymbol}${target.rank}を儀式召喚`);
    return { ok: true };
  }

  playJoker(player, jokerUid, mode) {
    if (this.winner || player !== this.currentPlayer) return { ok: false, error: '今は使えません' };
    const joker = player.hand.find((c) => c.uid === jokerUid && c.kind === 'joker');
    if (!joker) return { ok: false, error: 'ジョーカーがありません' };
    if (mode === 'ra' && player.field.length === 0) return { ok: false, error: '生贄にする使い魔がいません' };

    this.removeFromHand(player, joker.uid);
    player.grave.push(joker);

    if (mode === 'blackhole') {
      for (const p of this.players) {
        p.grave.push(...p.field);
        p.field = [];
      }
      this.logEvent(`${player.character.name}がJOKER：全破壊を使用`);
      return { ok: true };
    }

    if (mode === 'ra') {
      const power = player.field.reduce((sum, c) => sum + c.value, 0);
      player.grave.push(...player.field);
      player.field = [{
        id: 'JOKER-RA', code: 'JOKER', uid: `JOKER-RA-${uidCounter++}`,
        suit: null, suitSymbol: '★', suitName: 'ジョーカー', rank: 'JOKER', value: power, kind: 'familiar', temporaryJoker: true,
      }];
      this.logEvent(`${player.character.name}がJOKER：全生贄を使用（攻撃力${power}）`);
      return { ok: true };
    }

    return { ok: false, error: 'JOKERのモードが不正です' };
  }

  startBattle(attackerUid, defenderUid = null) {
    if (this.winner || this.battle) return { ok: false, error: '戦闘中です' };
    const attackerPlayer = this.currentPlayer;
    const defenderPlayer = this.opponent;
    if (attackerPlayer.attacksUsed >= RULES.attacksPerTurn) return { ok: false, error: 'このターンはもう攻撃しました' };
    if (this.turn === 0) return { ok: false, error: '先攻1ターン目は攻撃できません' };

    const attacker = attackerPlayer.field.find((c) => c.uid === attackerUid);
    if (!attacker) return { ok: false, error: '攻撃する使い魔がいません' };
    const defender = defenderUid ? defenderPlayer.field.find((c) => c.uid === defenderUid) : null;
    if (defenderPlayer.field.length > 0 && !defender) return { ok: false, error: '相手の使い魔を選んでください' };
    if (defenderPlayer.field.length === 0 && defenderUid) return { ok: false, error: '直接攻撃してください' };

    attackerPlayer.attacksUsed += 1;
    this.battle = {
      attackerPlayerIndex: this.currentPlayerIndex,
      defenderPlayerIndex: 1 - this.currentPlayerIndex,
      attackerUid,
      defenderUid: defender?.uid ?? null,
      attackerPower: attacker.value,
      defenderPower: defender?.value ?? 0,
      chainTurn: this.currentPlayerIndex,
      consecutivePasses: 0,
      stage: defender ? 'chain' : 'ace',
      result: defender ? null : { loserIndex: 1 - this.currentPlayerIndex, rawDamage: attacker.value },
    };
    this.logEvent(`${attackerPlayer.character.name}の${attacker.suitSymbol}${attacker.rank}が攻撃`);
    if (!defender) this.logEvent(`直接攻撃 ${attacker.value}ダメージ`);
    return { ok: true };
  }

  chainOptions(player) {
    if (!this.battle || this.battle.stage !== 'chain') return [];
    return player.hand.filter(isSpadeBoost);
  }

  playSpadeBoost(player, cardUid) {
    if (!this.battle || this.battle.stage !== 'chain') return { ok: false, error: 'チェーン中ではありません' };
    const index = this.players.indexOf(player);
    if (index !== this.battle.chainTurn) return { ok: false, error: '相手の応答待ちです' };
    const card = player.hand.find((c) => c.uid === cardUid && isSpadeBoost(c));
    if (!card) return { ok: false, error: 'スペードがありません' };

    this.removeFromHand(player, card.uid);
    player.grave.push(card);
    if (index === this.battle.attackerPlayerIndex) this.battle.attackerPower += card.value;
    else this.battle.defenderPower += card.value;
    this.battle.consecutivePasses = 0;
    this.battle.chainTurn = 1 - index;
    this.logEvent(`${player.character.name}が${card.suitSymbol}${card.rank}をチェーン（+${card.value}）`);
    return { ok: true };
  }

  passChain(player) {
    if (!this.battle || this.battle.stage !== 'chain') return { ok: false, error: 'チェーン中ではありません' };
    const index = this.players.indexOf(player);
    if (index !== this.battle.chainTurn) return { ok: false, error: '相手の応答待ちです' };
    this.battle.consecutivePasses += 1;
    this.logEvent(`${player.character.name}がチェーンをパス`);
    if (this.battle.consecutivePasses >= 2) {
      this.prepareBattleResult();
    } else {
      this.battle.chainTurn = 1 - index;
    }
    return { ok: true };
  }

  prepareBattleResult() {
    const b = this.battle;
    if (!b) return;
    const atkP = this.players[b.attackerPlayerIndex];
    const defP = this.players[b.defenderPlayerIndex];
    let loserIndex = null;
    let damage = 0;

    if (!b.defenderUid) {
      loserIndex = b.defenderPlayerIndex;
      damage = b.attackerPower;
    } else if (b.attackerPower > b.defenderPower) {
      loserIndex = b.defenderPlayerIndex;
      damage = b.attackerPower - b.defenderPower;
    } else if (b.defenderPower > b.attackerPower) {
      loserIndex = b.attackerPlayerIndex;
      damage = b.defenderPower - b.attackerPower;
    }

    b.result = { loserIndex, rawDamage: damage };
    b.stage = damage > 0 && loserIndex !== null ? 'ace' : 'resolve';

    if (b.stage === 'resolve') this.resolveBattle(false);
    else this.logEvent(`戦闘値 ${atkP.character.name}:${b.attackerPower} / ${defP.character.name}:${b.defenderPower}`);
  }

  canUseAce(player) {
    if (!this.battle || this.battle.stage !== 'ace') return false;
    const loser = this.players[this.battle.result.loserIndex];
    return loser === player && player.hand.some((c) => c.kind === 'ace');
  }

  resolveBattle(useAce = false, aceUid = null) {
    const b = this.battle;
    if (!b) return { ok: false, error: '戦闘がありません' };
    if (!['ace', 'resolve'].includes(b.stage)) return { ok: false, error: 'まだチェーン中です' };

    const atkP = this.players[b.attackerPlayerIndex];
    const defP = this.players[b.defenderPlayerIndex];
    const attacker = atkP.field.find((c) => c.uid === b.attackerUid);
    const defender = b.defenderUid ? defP.field.find((c) => c.uid === b.defenderUid) : null;

    let damage = b.result?.rawDamage ?? 0;
    const loserIndex = b.result?.loserIndex ?? null;

    if (useAce && loserIndex !== null) {
      const loser = this.players[loserIndex];
      const ace = loser.hand.find((c) => c.uid === aceUid && c.kind === 'ace') ?? loser.hand.find((c) => c.kind === 'ace');
      if (!ace) return { ok: false, error: 'Aがありません' };
      this.removeFromHand(loser, ace.uid);
      loser.grave.push(ace);
      damage = 0;
      this.logEvent(`${loser.character.name}がAを使用。戦闘ダメージ0`);
    }

    if (defender) {
      if (b.attackerPower > b.defenderPower) {
        this.sendFieldToGrave(defP, defender.uid);
      } else if (b.defenderPower > b.attackerPower) {
        if (attacker) this.sendFieldToGrave(atkP, attacker.uid);
      } else {
        if (attacker) this.sendFieldToGrave(atkP, attacker.uid);
        this.sendFieldToGrave(defP, defender.uid);
        this.logEvent('同値。双方の使い魔が墓地へ');
      }
    }

    if (damage > 0 && loserIndex !== null) {
      const loser = this.players[loserIndex];
      const finalDamage = loser.characterId === 'madoka'
        ? Math.max(0, damage - RULES.madokaDamageReduction)
        : damage;
      if (finalDamage !== damage) this.logEvent(`まどかの能力で${damage}→${finalDamage}ダメージ`);
      this.applyDamage(loser, finalDamage);
    }

    this.battle = null;
    return { ok: true };
  }

  applyDamage(player, damage) {
    if (damage <= 0 || this.winner) return;
    this.logEvent(`${player.character.name}が${damage}ダメージ`);
    const handGain = Math.ceil(damage / 3);
    const revealed = [];
    for (let i = 0; i < damage; i += 1) {
      if (player.deck.length === 0) {
        this.setLoser(player, 'デッキ切れ');
        break;
      }
      revealed.push(player.deck.shift());
    }
    const toHand = revealed.slice(0, handGain);
    const toGrave = revealed.slice(handGain);
    player.hand.push(...toHand);
    player.grave.push(...toGrave);
    if (toHand.length) this.logEvent(`${player.character.name}はダメージから${toHand.length}枚を手札へ`);
    if (player.deck.length === 0 && !this.winner) this.setLoser(player, 'デッキ切れ');
  }

  sendFieldToGrave(player, uid) {
    const index = player.field.findIndex((c) => c.uid === uid);
    if (index < 0) return null;
    const [card] = player.field.splice(index, 1);
    player.grave.push(card);
    return card;
  }

  removeFromHand(player, uid) {
    const index = player.hand.findIndex((c) => c.uid === uid);
    if (index < 0) return null;
    return player.hand.splice(index, 1)[0];
  }

  setLoser(player, reason) {
    const winner = this.players.find((p) => p !== player);
    this.winner = winner;
    this.logEvent(`${player.character.name}敗北（${reason}）。${winner.character.name}の勝利`);
  }

  logEvent(message) {
    this.log.push(message);
    if (this.log.length > 100) this.log.shift();
  }
}
