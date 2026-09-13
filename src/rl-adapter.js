import { CARD_TYPES, PHASES } from './game-engine.js';

export const RL_LIMITS = Object.freeze({
  MAX_HAND: 30,
  FIELD_SLOTS: 5,
  MAX_GRAVE: 30,
  MAX_CHAIN: 30,
  TRIBUTE_MASKS: 32,
});

const SUMMON_COUNT = RL_LIMITS.MAX_HAND * RL_LIMITS.TRIBUTE_MASKS;
const ATTACK_COUNT = RL_LIMITS.FIELD_SLOTS * RL_LIMITS.FIELD_SLOTS;

export const ACTIONS = Object.freeze({
  PASS: 0,
  END_TURN: 1,
  SPECIAL: 2,
  SUMMON_BASE: 3,
  ATTACK_BASE: 3 + SUMMON_COUNT,
  MAIN_MAGIC_BASE: 3 + SUMMON_COUNT + ATTACK_COUNT,
  CHAIN_BASE: 3 + SUMMON_COUNT + ATTACK_COUNT + RL_LIMITS.MAX_HAND,
  REVIVE_BASE: 3 + SUMMON_COUNT + ATTACK_COUNT + RL_LIMITS.MAX_HAND * 2,
  COUNT: 3 + SUMMON_COUNT + ATTACK_COUNT + RL_LIMITS.MAX_HAND * 3,
});

const CARD_FEATURES = 11;
const CHAIN_FEATURES = 5;
const GLOBAL_FEATURES = 24;
export const OBSERVATION_SIZE = GLOBAL_FEATURES
  + RL_LIMITS.MAX_HAND * CARD_FEATURES
  + RL_LIMITS.FIELD_SLOTS * CARD_FEATURES * 2
  + RL_LIMITS.MAX_GRAVE * CARD_FEATURES * 2
  + RL_LIMITS.MAX_CHAIN * CHAIN_FEATURES;

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const norm = (x, d) => clamp01((x ?? 0) / d);

export function tributeSlotsToMask(slots = []) {
  return [...new Set(slots)].reduce((mask, slot) => mask | (1 << slot), 0);
}

export function tributeMaskToSlots(mask) {
  const slots = [];
  for (let i = 0; i < RL_LIMITS.FIELD_SLOTS; i++) if (mask & (1 << i)) slots.push(i);
  return slots;
}

export function encodeSummon(handIndex, tributeMask = 0) {
  return ACTIONS.SUMMON_BASE + handIndex * RL_LIMITS.TRIBUTE_MASKS + tributeMask;
}

export function encodeAttack(attackerSlot, targetSlot) {
  return ACTIONS.ATTACK_BASE + attackerSlot * RL_LIMITS.FIELD_SLOTS + targetSlot;
}

export function encodeMainMagic(handIndex) { return ACTIONS.MAIN_MAGIC_BASE + handIndex; }
export function encodeChain(handIndex) { return ACTIONS.CHAIN_BASE + handIndex; }
export function encodeRevive(graveIndex) { return ACTIONS.REVIVE_BASE + graveIndex; }

function cardFeatures(card) {
  if (!card) return Array(CARD_FEATURES).fill(0);
  return [
    1,
    card.type === CARD_TYPES.FAMILIAR ? 1 : 0,
    card.type === CARD_TYPES.WITCH ? 1 : 0,
    card.type === CARD_TYPES.MAGIC ? 1 : 0,
    norm(card.attack, 13),
    norm(card.tributeThreshold, 13),
    norm(card.value, 13),
    card.effect === 'draw' ? 1 : 0,
    card.effect === 'boost' ? 1 : 0,
    card.effect === 'nullifyDamage' ? 1 : 0,
    norm(card.rank, 13),
  ];
}

function appendCards(out, cards, max) {
  for (let i = 0; i < max; i++) out.push(...cardFeatures(cards[i] ?? null));
}

function chainFeatures(item, playerIndex) {
  if (!item) return Array(CHAIN_FEATURES).fill(0);
  return [
    1,
    item.player === playerIndex ? 1 : 0,
    item.card?.effect === 'boost' ? 1 : 0,
    item.card?.effect === 'nullifyDamage' ? 1 : 0,
    norm(item.card?.value, 13),
  ];
}

export class RLAdapter {
  constructor(engine) {
    this.engine = engine;
    this.logCursor = engine.state.logs.length;
    this.stats = this._newStats();
  }

  _newStats() {
    return {
      actions: 0,
      passes: 0,
      summons: [0, 0],
      witchSummons: [0, 0],
      attacks: [0, 0],
      mainMagic: [0, 0],
      chainCards: [0, 0],
      specials: [0, 0],
      revives: [0, 0],
      damageTaken: [0, 0],
      earlyDamageTaken: [0, 0],
      damageEvents: [0, 0],
      threeNPlusOneEvents: [0, 0],
      maxChain: 0,
    };
  }

  currentPlayer() {
    return this.engine.state.pendingDecision?.player ?? this.engine.state.priorityPlayer;
  }

  observation(playerIndex) {
    const s = this.engine.state;
    const self = this.engine.player(playerIndex);
    const opp = this.engine.player(this.engine.opponent(playerIndex));
    const pending = s.pendingDecision?.type ?? null;
    const battle = s.battle ?? null;
    const out = [
      norm(s.turn, 100),
      s.activePlayer === playerIndex ? 1 : 0,
      s.priorityPlayer === playerIndex ? 1 : 0,
      s.phase === PHASES.MAIN ? 1 : 0,
      s.phase === PHASES.CHAIN ? 1 : 0,
      s.phase === PHASES.GAME_OVER ? 1 : 0,
      pending === null ? 1 : 0,
      pending === 'CHAIN_RESPONSE' ? 1 : 0,
      pending === 'MADOKA_REVIVE' ? 1 : 0,
      norm(self.deck.length, 30),
      norm(opp.deck.length, 30),
      norm(self.hand.length, 30),
      norm(opp.hand.length, 30),
      norm(self.graveyard.length, 30),
      norm(opp.graveyard.length, 30),
      self.character?.id === 'madoka' ? 1 : 0,
      self.character?.id === 'mami' ? 1 : 0,
      opp.character?.id === 'madoka' ? 1 : 0,
      opp.character?.id === 'mami' ? 1 : 0,
      battle ? 1 : 0,
      battle?.attackerPlayer === playerIndex ? 1 : 0,
      norm((battle?.attackerBase ?? 0) + (battle?.attackerBonus ?? 0), 40),
      norm((battle?.defenderBase ?? 0) + (battle?.defenderBonus ?? 0), 40),
      norm(s.chain.length, 30),
    ];

    appendCards(out, self.hand, RL_LIMITS.MAX_HAND);
    appendCards(out, self.field, RL_LIMITS.FIELD_SLOTS);
    appendCards(out, opp.field, RL_LIMITS.FIELD_SLOTS);
    appendCards(out, self.graveyard, RL_LIMITS.MAX_GRAVE);
    appendCards(out, opp.graveyard, RL_LIMITS.MAX_GRAVE);
    for (let i = 0; i < RL_LIMITS.MAX_CHAIN; i++) out.push(...chainFeatures(s.chain[i] ?? null, playerIndex));

    if (out.length !== OBSERVATION_SIZE) throw new Error(`Observation size mismatch: ${out.length}`);
    return out;
  }

  legalActions(playerIndex = this.currentPlayer()) {
    const s = this.engine.state;
    if (s.phase === PHASES.GAME_OVER) return [];

    const d = s.pendingDecision;
    if (d) {
      if (d.player !== playerIndex) return [];
      const p = this.engine.player(playerIndex);
      if (d.type === 'CHAIN_RESPONSE') {
        const actions = [ACTIONS.PASS];
        for (const id of d.options) {
          const i = p.hand.findIndex(c => c.id === id);
          if (i >= 0 && i < RL_LIMITS.MAX_HAND) actions.push(encodeChain(i));
        }
        return actions;
      }
      if (d.type === 'MADOKA_REVIVE') {
        return d.options.flatMap(id => {
          const i = p.graveyard.findIndex(c => c.id === id);
          return i >= 0 && i < RL_LIMITS.MAX_GRAVE ? [encodeRevive(i)] : [];
        });
      }
      return [];
    }

    if (s.priorityPlayer !== playerIndex) return [];
    const p = this.engine.player(playerIndex);
    const actions = [ACTIONS.PASS];

    if (this.engine.canUseSpecial(playerIndex)) actions.push(ACTIONS.SPECIAL);

    if (s.activePlayer === playerIndex) {
      actions.push(ACTIONS.END_TURN);
      for (let i = 0; i < Math.min(p.hand.length, RL_LIMITS.MAX_HAND); i++) {
        const card = p.hand[i];
        if (this.engine.canActivateMainMagic(playerIndex, card.id)) actions.push(encodeMainMagic(i));
        if (!this.engine.canSummon(playerIndex, card.id)) continue;
        if (card.type === CARD_TYPES.FAMILIAR) {
          actions.push(encodeSummon(i, 0));
        } else if (card.type === CARD_TYPES.WITCH) {
          for (const set of this.engine.validTributeSets(playerIndex, card)) {
            actions.push(encodeSummon(i, tributeSlotsToMask(set.slots)));
          }
        }
      }

      if (!(s.turn === 1 && playerIndex === 0)) {
        const opp = this.engine.player(this.engine.opponent(playerIndex));
        for (let a = 0; a < RL_LIMITS.FIELD_SLOTS; a++) {
          if (!p.field[a]) continue;
          for (let t = 0; t < RL_LIMITS.FIELD_SLOTS; t++) {
            if (opp.field[t]) actions.push(encodeAttack(a, t));
          }
        }
      }
    }

    return [...new Set(actions)];
  }

  actionMask(playerIndex = this.currentPlayer()) {
    const mask = Array(ACTIONS.COUNT).fill(0);
    for (const action of this.legalActions(playerIndex)) mask[action] = 1;
    return mask;
  }

  applyAction(action, playerIndex = this.currentPlayer()) {
    if (!Number.isInteger(action) || action < 0 || action >= ACTIONS.COUNT) throw new Error('Action out of range.');
    if (!this.legalActions(playerIndex).includes(action)) throw new Error(`Illegal action ${action} for player ${playerIndex}.`);
    const s = this.engine.state;
    const d = s.pendingDecision;
    this.stats.actions += 1;

    if (d?.type === 'CHAIN_RESPONSE') {
      if (action === ACTIONS.PASS) {
        this.stats.passes += 1;
        this.engine.respondChain(playerIndex, null);
      } else {
        const handIndex = action - ACTIONS.CHAIN_BASE;
        const card = this.engine.player(playerIndex).hand[handIndex];
        this.stats.chainCards[playerIndex] += 1;
        this.engine.respondChain(playerIndex, card.id);
      }
      this._afterAction();
      return;
    }

    if (d?.type === 'MADOKA_REVIVE') {
      const graveIndex = action - ACTIONS.REVIVE_BASE;
      const card = this.engine.player(playerIndex).graveyard[graveIndex];
      this.stats.revives[playerIndex] += 1;
      this.engine.selectReviveTarget(playerIndex, card.id);
      this._afterAction();
      return;
    }

    if (action === ACTIONS.PASS) {
      this.stats.passes += 1;
      this.engine.passPriorityTo(this.engine.opponent(playerIndex));
    } else if (action === ACTIONS.END_TURN) {
      this.engine.endTurn(playerIndex);
    } else if (action === ACTIONS.SPECIAL) {
      this.stats.specials[playerIndex] += 1;
      this.engine.activateSpecial(playerIndex);
    } else if (action >= ACTIONS.SUMMON_BASE && action < ACTIONS.ATTACK_BASE) {
      const offset = action - ACTIONS.SUMMON_BASE;
      const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
      const tributeMask = offset % RL_LIMITS.TRIBUTE_MASKS;
      const card = this.engine.player(playerIndex).hand[handIndex];
      this.stats.summons[playerIndex] += 1;
      if (card.type === CARD_TYPES.WITCH) this.stats.witchSummons[playerIndex] += 1;
      this.engine.summon(playerIndex, card.id, tributeMaskToSlots(tributeMask));
    } else if (action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE) {
      const offset = action - ACTIONS.ATTACK_BASE;
      const attacker = Math.floor(offset / RL_LIMITS.FIELD_SLOTS);
      const target = offset % RL_LIMITS.FIELD_SLOTS;
      this.stats.attacks[playerIndex] += 1;
      this.engine.attack(playerIndex, attacker, target);
    } else if (action >= ACTIONS.MAIN_MAGIC_BASE && action < ACTIONS.CHAIN_BASE) {
      const handIndex = action - ACTIONS.MAIN_MAGIC_BASE;
      const card = this.engine.player(playerIndex).hand[handIndex];
      this.stats.mainMagic[playerIndex] += 1;
      this.engine.activateMainMagic(playerIndex, card.id);
    } else {
      throw new Error(`Unrecognized action ${action}.`);
    }

    this._afterAction();
  }

  _afterAction() {
    this.stats.maxChain = Math.max(this.stats.maxChain, this.engine.state.chain.length);
    const logs = this.engine.state.logs;
    for (; this.logCursor < logs.length; this.logCursor++) {
      const line = logs[this.logCursor];
      for (let i = 0; i < 2; i++) {
        const name = this.engine.player(i).name;
        if (!line.startsWith(`${name}が戦闘に敗北（ダメージ `)) continue;
        const m = line.match(/ダメージ (\d+)/);
        const damage = m ? Number(m[1]) : 0;
        this.stats.damageTaken[i] += damage;
        if (this.engine.state.turn <= 5) this.stats.earlyDamageTaken[i] += damage;
        if (damage > 0) {
          this.stats.damageEvents[i] += 1;
          if (damage % 3 === 1) this.stats.threeNPlusOneEvents[i] += 1;
        }
      }
    }
  }

  info() {
    return {
      turn: this.engine.state.turn,
      activePlayer: this.engine.state.activePlayer,
      currentPlayer: this.currentPlayer(),
      phase: this.engine.state.phase,
      terminated: this.engine.state.phase === PHASES.GAME_OVER,
      winner: this.engine.state.winner,
      stats: structuredClone(this.stats),
    };
  }
}

export function rlSpec() {
  return {
    actionCount: ACTIONS.COUNT,
    observationSize: OBSERVATION_SIZE,
    limits: RL_LIMITS,
  };
}
