import { ACTIONS, ATTACK_TARGETS, RL_LIMITS, tributeMaskToSlots } from './rl-adapter.js';
import { CARD_TYPES } from './game-engine.js';

export const EVALUATION_POLICY_FORMAT = 'girls-cardgame-eval-v1';
export const EVALUATION_RULES_VERSION = '2026-09-13-hand-tributes-shield-ga-v1';

export const FEATURE_NAMES = Object.freeze([
  'projectedDeckAdvantage', 'projectedHandAdvantage', 'projectedFieldPowerAdvantage',
  'projectedFieldCountAdvantage', 'projectedWitchPowerAdvantage', 'specialReserveAdvantage',
  'madokaReviveAdvantage', 'damageToOpponent', 'damageToSelf', 'enemyPowerRemoved',
  'ownPowerLost', 'cardsSpent', 'summonPower', 'witchSummon', 'bossSummon', 'drawCards',
  'specialRemovalPower', 'specialRemovalCount', 'revivePower', 'salvationRevive', 'turnEnds',
  'passAction', 'directAttack', 'chainBoost', 'shieldUse', 'shieldSavedPower', 'lethal',
  'selfLethal', 'terminalWin', 'terminalLoss',
]);

export const DEFAULT_WEIGHTS = Object.freeze({
  projectedDeckAdvantage: 8,
  projectedHandAdvantage: 2,
  projectedFieldPowerAdvantage: 9,
  projectedFieldCountAdvantage: 4,
  projectedWitchPowerAdvantage: 2,
  specialReserveAdvantage: 2.5,
  madokaReviveAdvantage: 2,
  damageToOpponent: 8,
  damageToSelf: -8,
  enemyPowerRemoved: 6,
  ownPowerLost: -7,
  cardsSpent: -1.5,
  summonPower: 4,
  witchSummon: 1,
  bossSummon: 1,
  drawCards: 1.5,
  specialRemovalPower: 5,
  specialRemovalCount: 2,
  revivePower: 6,
  salvationRevive: 3,
  turnEnds: -1,
  passAction: -0.2,
  directAttack: 1,
  chainBoost: 4,
  shieldUse: 2,
  shieldSavedPower: 6,
  lethal: 100,
  selfLethal: -100,
  terminalWin: 1000,
  terminalLoss: -1000,
});

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const norm = (value, scale) => clamp((value ?? 0) / scale);
const sumAttack = cards => cards.reduce((sum, card) => sum + (card?.attack ?? 0), 0);
const countMonsters = cards => cards.filter(Boolean).length;
const witchPower = cards => cards.reduce((sum, card) => sum + (card?.type === CARD_TYPES.WITCH ? card.attack ?? 0 : 0), 0);
const maxMonsterAttack = cards => Math.max(0, ...cards.filter(card => card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type)).map(card => card.attack ?? 0));
const isSalvation = card => !!card && (card.code?.includes('salvation') || card.name === '救済の魔女');

function emptyFeatures() {
  return Object.fromEntries(FEATURE_NAMES.map(name => [name, 0]));
}

export function makeEvaluationGenome(weights = DEFAULT_WEIGHTS, meta = {}) {
  const merged = {};
  for (const name of FEATURE_NAMES) merged[name] = Number.isFinite(weights?.[name]) ? Number(weights[name]) : DEFAULT_WEIGHTS[name];
  merged.terminalWin = DEFAULT_WEIGHTS.terminalWin;
  merged.terminalLoss = DEFAULT_WEIGHTS.terminalLoss;
  return {
    format: EVALUATION_POLICY_FORMAT,
    rulesVersion: EVALUATION_RULES_VERSION,
    generation: Number.isInteger(meta.generation) ? meta.generation : 0,
    id: meta.id ?? 'evaluation-default',
    parents: Array.isArray(meta.parents) ? [...meta.parents] : [],
    weights: merged,
  };
}

export const DEFAULT_GENOME = Object.freeze(makeEvaluationGenome(DEFAULT_WEIGHTS));

export function normalizeEvaluationGenome(data) {
  if (!data || typeof data !== 'object') throw new Error('評価AIのデータが不正です。');
  if (data.format && data.format !== EVALUATION_POLICY_FORMAT) throw new Error('評価AIの形式が対応していません。');
  if (data.rulesVersion && data.rulesVersion !== EVALUATION_RULES_VERSION) throw new Error('評価AIのルール版が現在のゲームと一致しません。');
  return makeEvaluationGenome(data.weights ?? data, data);
}

function baseProjection(engine, playerIndex) {
  const self = engine.player(playerIndex);
  const opp = engine.player(engine.opponent(playerIndex));
  return {
    self, opp,
    selfDeck: self.deck.length, oppDeck: opp.deck.length,
    selfHand: self.hand.length, oppHand: opp.hand.length,
    selfFieldPower: sumAttack(self.field), oppFieldPower: sumAttack(opp.field),
    selfFieldCount: countMonsters(self.field), oppFieldCount: countMonsters(opp.field),
    selfWitchPower: witchPower(self.field), oppWitchPower: witchPower(opp.field),
    selfSpecialUnused: self.specialUsed ? 0 : 1, oppSpecialUnused: opp.specialUsed ? 0 : 1,
    selfReviveMax: maxMonsterAttack(self.graveyard), oppReviveMax: maxMonsterAttack(opp.graveyard),
    terminalWin: 0, terminalLoss: 0,
  };
}

function removeFieldMonster(proj, side, card) {
  if (!card) return;
  const powerKey = side === 'self' ? 'selfFieldPower' : 'oppFieldPower';
  const countKey = side === 'self' ? 'selfFieldCount' : 'oppFieldCount';
  const witchKey = side === 'self' ? 'selfWitchPower' : 'oppWitchPower';
  const reviveKey = side === 'self' ? 'selfReviveMax' : 'oppReviveMax';
  proj[powerKey] -= card.attack ?? 0;
  proj[countKey] -= 1;
  if (card.type === CARD_TYPES.WITCH) proj[witchKey] -= card.attack ?? 0;
  if ([CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type)) proj[reviveKey] = Math.max(proj[reviveKey], card.attack ?? 0);
}

function addFieldMonster(proj, side, card) {
  if (!card) return;
  const powerKey = side === 'self' ? 'selfFieldPower' : 'oppFieldPower';
  const countKey = side === 'self' ? 'selfFieldCount' : 'oppFieldCount';
  const witchKey = side === 'self' ? 'selfWitchPower' : 'oppWitchPower';
  proj[powerKey] += card.attack ?? 0;
  proj[countKey] += 1;
  if (card.type === CARD_TYPES.WITCH) proj[witchKey] += card.attack ?? 0;
}

function applyDeckDamage(proj, side, damage) {
  const deckKey = side === 'self' ? 'selfDeck' : 'oppDeck';
  const handKey = side === 'self' ? 'selfHand' : 'oppHand';
  const actual = Math.min(Math.max(0, Math.floor(damage)), proj[deckKey]);
  proj[deckKey] -= actual;
  proj[handKey] += Math.min(actual, Math.ceil(Math.max(0, damage) / 3));
  if (proj[deckKey] === 0) {
    if (side === 'self') proj.terminalLoss = 1;
    else proj.terminalWin = 1;
  }
  return actual;
}

function reducedDamage(player, damage) {
  return player.character?.id === 'madoka' ? Math.max(0, damage - 1) : Math.max(0, damage);
}

function currentBattleValues(state, extraCard = null, extraPlayer = null) {
  const battle = state.battle;
  if (!battle) return null;
  let attacker = battle.attackerBase + battle.attackerBonus;
  let defender = battle.defenderBase + battle.defenderBonus;
  const shielded = [false, false];
  const apply = (player, card) => {
    if (card.effect === 'boost') {
      if (player === battle.attackerPlayer) attacker += card.value ?? 0;
      else if (player === battle.defenderPlayer) defender += card.value ?? 0;
    } else if (card.effect === 'nullifyDamage') shielded[player] = true;
  };
  for (const item of state.chain ?? []) apply(item.player, item.card);
  if (extraCard) apply(extraPlayer, extraCard);
  return { attacker, defender, shielded };
}

function projectBattle(proj, engine, playerIndex, values, features, battleOverride = null) {
  const battle = battleOverride ?? engine.state.battle;
  if (!battle || !values) return;
  const attackerCard = engine.player(battle.attackerPlayer).field[battle.attackerSlot];
  const defenderCard = battle.direct ? null : engine.player(battle.defenderPlayer).field[battle.defenderSlot];
  const protectedFromDestruction = (absolutePlayer, card) => values.shielded[absolutePlayer] && card?.type === CARD_TYPES.FAMILIAR;

  if (battle.direct) {
    const defender = engine.player(battle.defenderPlayer);
    const damage = reducedDamage(defender, values.attacker);
    if (battle.defenderPlayer === playerIndex) {
      features.damageToSelf += norm(damage, 13);
      if (damage >= proj.selfDeck) features.selfLethal = 1;
      applyDeckDamage(proj, 'self', damage);
    } else {
      features.damageToOpponent += norm(damage, 13);
      if (damage >= proj.oppDeck) features.lethal = 1;
      applyDeckDamage(proj, 'opp', damage);
    }
    return;
  }

  if (!attackerCard || !defenderCard) return;
  if (values.attacker === values.defender) {
    if (!protectedFromDestruction(battle.attackerPlayer, attackerCard)) {
      const side = battle.attackerPlayer === playerIndex ? 'self' : 'opp';
      removeFieldMonster(proj, side, attackerCard);
      if (side === 'self') features.ownPowerLost += norm(attackerCard.attack, 20);
      else features.enemyPowerRemoved += norm(attackerCard.attack, 20);
    } else if (battle.attackerPlayer === playerIndex) features.shieldSavedPower += norm(attackerCard.attack, 13);
    if (!protectedFromDestruction(battle.defenderPlayer, defenderCard)) {
      const side = battle.defenderPlayer === playerIndex ? 'self' : 'opp';
      removeFieldMonster(proj, side, defenderCard);
      if (side === 'self') features.ownPowerLost += norm(defenderCard.attack, 20);
      else features.enemyPowerRemoved += norm(defenderCard.attack, 20);
    } else if (battle.defenderPlayer === playerIndex) features.shieldSavedPower += norm(defenderCard.attack, 13);
    return;
  }

  const attackerWins = values.attacker > values.defender;
  const loserPlayer = attackerWins ? battle.defenderPlayer : battle.attackerPlayer;
  const loserCard = attackerWins ? defenderCard : attackerCard;
  const loserSide = loserPlayer === playerIndex ? 'self' : 'opp';
  if (!protectedFromDestruction(loserPlayer, loserCard)) {
    removeFieldMonster(proj, loserSide, loserCard);
    if (loserSide === 'self') features.ownPowerLost += norm(loserCard.attack, 20);
    else features.enemyPowerRemoved += norm(loserCard.attack, 20);
  } else if (loserSide === 'self') features.shieldSavedPower += norm(loserCard.attack, 13);

  const loser = engine.player(loserPlayer);
  const damage = values.shielded[loserPlayer] ? 0 : reducedDamage(loser, Math.abs(values.attacker - values.defender));
  if (loserSide === 'self') {
    features.damageToSelf += norm(damage, 13);
    if (damage >= proj.selfDeck) features.selfLethal = 1;
    applyDeckDamage(proj, 'self', damage);
  } else {
    features.damageToOpponent += norm(damage, 13);
    if (damage >= proj.oppDeck) features.lethal = 1;
    applyDeckDamage(proj, 'opp', damage);
  }
}

function matchingTributePlan(engine, playerIndex, card, slots) {
  if (card.type !== CARD_TYPES.WITCH) return { slots: [], handIds: [], total: 0 };
  const sorted = [...slots].sort((a, b) => a - b);
  return engine.validTributeSets(playerIndex, card).find(plan => plan.slots.length === sorted.length && plan.slots.every((slot, i) => slot === sorted[i])) ?? null;
}

export function actionFeatures(adapter, playerIndex, action) {
  const engine = adapter.engine;
  const state = engine.state;
  const proj = baseProjection(engine, playerIndex);
  const self = proj.self;
  const opp = proj.opp;
  const features = emptyFeatures();

  if (state.pendingDecision?.type === 'CHAIN_RESPONSE') {
    if (action === ACTIONS.PASS) {
      features.passAction = 1;
      projectBattle(proj, engine, playerIndex, currentBattleValues(state), features);
    } else {
      const card = self.hand[action - ACTIONS.CHAIN_BASE];
      if (card) {
        proj.selfHand -= 1;
        features.cardsSpent += norm(1, 5);
        if (card.effect === 'boost') features.chainBoost = norm(card.value, 5);
        if (card.effect === 'nullifyDamage') features.shieldUse = 1;
        projectBattle(proj, engine, playerIndex, currentBattleValues(state, card, playerIndex), features);
      }
    }
  } else if (state.pendingDecision?.type === 'MADOKA_REVIVE') {
    const card = self.graveyard[action - ACTIONS.REVIVE_BASE];
    if (card) {
      addFieldMonster(proj, 'self', card);
      proj.selfReviveMax = maxMonsterAttack(self.graveyard.filter((_, i) => i !== action - ACTIONS.REVIVE_BASE));
      features.revivePower = norm(card.attack, 13);
      features.salvationRevive = isSalvation(card) ? 1 : 0;
      features.turnEnds = 1;
    }
  } else if (action === ACTIONS.PASS) {
    features.passAction = 1;
  } else if (action === ACTIONS.END_TURN) {
    features.turnEnds = 1;
  } else if (action === ACTIONS.ENTER_BATTLE || action === ACTIONS.CONTINUE_BATTLE) {
    // Position is unchanged. Keeping the special unused is represented below.
  } else if (action === ACTIONS.SPECIAL) {
    proj.selfSpecialUnused = 0;
    features.turnEnds = 1;
    if (self.character?.id === 'mami') {
      features.specialRemovalPower = norm(proj.oppFieldPower, 40);
      features.specialRemovalCount = norm(proj.oppFieldCount, 5);
      for (const card of opp.field) if (card) removeFieldMonster(proj, 'opp', card);
    } else if (self.character?.id === 'madoka') {
      const candidates = self.graveyard.filter(card => [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type));
      const best = candidates.sort((a, b) => (b.attack ?? 0) - (a.attack ?? 0))[0];
      if (best && proj.selfFieldCount < RL_LIMITS.FIELD_SLOTS) {
        addFieldMonster(proj, 'self', best);
        features.revivePower = norm(best.attack, 13);
        features.salvationRevive = isSalvation(best) ? 1 : 0;
      }
    }
  } else if (action >= ACTIONS.SUMMON_BASE && action < ACTIONS.ATTACK_BASE) {
    const offset = action - ACTIONS.SUMMON_BASE;
    const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
    const tributeSlots = tributeMaskToSlots(offset % RL_LIMITS.TRIBUTE_MASKS);
    const card = self.hand[handIndex];
    if (card) {
      const plan = matchingTributePlan(engine, playerIndex, card, tributeSlots);
      let spent = 1;
      let tributePower = 0;
      if (plan) {
        for (const slot of plan.slots) {
          const tribute = self.field[slot];
          if (tribute) {
            tributePower += tribute.attack ?? 0;
            removeFieldMonster(proj, 'self', tribute);
            spent += 1;
          }
        }
        for (const id of plan.handIds ?? []) {
          const tribute = self.hand.find(c => c.id === id);
          if (tribute) {
            tributePower += tribute.attack ?? 0;
            proj.selfReviveMax = Math.max(proj.selfReviveMax, tribute.attack ?? 0);
            spent += 1;
          }
        }
        proj.selfHand -= (plan.handIds?.length ?? 0);
      }
      proj.selfHand -= 1;
      addFieldMonster(proj, 'self', card);
      features.cardsSpent = norm(spent, 5);
      features.ownPowerLost += norm(tributePower, 26);
      features.summonPower = norm(card.attack, 13);
      features.witchSummon = card.type === CARD_TYPES.WITCH ? 1 : 0;
      features.bossSummon = (card.attack ?? 0) >= 13 ? 1 : 0;
    }
  } else if (action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE) {
    const offset = action - ACTIONS.ATTACK_BASE;
    const attackerSlot = Math.floor(offset / ATTACK_TARGETS);
    const targetCode = offset % ATTACK_TARGETS;
    const attacker = self.field[attackerSlot];
    if (attacker) {
      const direct = targetCode === RL_LIMITS.FIELD_SLOTS;
      features.directAttack = direct ? 1 : 0;
      const target = direct ? null : opp.field[targetCode];
      const virtualState = {
        ...state,
        battle: {
          attackerPlayer: playerIndex, attackerSlot,
          defenderPlayer: engine.opponent(playerIndex), defenderSlot: direct ? null : targetCode,
          direct, attackerBase: attacker.attack ?? 0, defenderBase: target?.attack ?? 0,
          attackerBonus: 0, defenderBonus: 0,
        },
        chain: [],
      };
      projectBattle(proj, engine, playerIndex, currentBattleValues(virtualState), features, virtualState.battle);
    }
  } else if (action >= ACTIONS.MAIN_MAGIC_BASE && action < ACTIONS.CHAIN_BASE) {
    const card = self.hand[action - ACTIONS.MAIN_MAGIC_BASE];
    if (card?.effect === 'draw') {
      proj.selfHand -= 1;
      features.cardsSpent = norm(1, 5);
      const drawn = Math.min(card.value ?? 0, proj.selfDeck);
      proj.selfDeck -= drawn;
      proj.selfHand += drawn;
      features.drawCards = norm(drawn, 2);
      if (proj.selfDeck === 0) {
        proj.terminalLoss = 1;
        features.selfLethal = 1;
      }
    }
  }

  features.projectedDeckAdvantage = norm(proj.selfDeck - proj.oppDeck, 30);
  features.projectedHandAdvantage = norm(proj.selfHand - proj.oppHand, 15);
  features.projectedFieldPowerAdvantage = norm(proj.selfFieldPower - proj.oppFieldPower, 40);
  features.projectedFieldCountAdvantage = norm(proj.selfFieldCount - proj.oppFieldCount, 5);
  features.projectedWitchPowerAdvantage = norm(proj.selfWitchPower - proj.oppWitchPower, 30);
  features.specialReserveAdvantage = clamp(proj.selfSpecialUnused - proj.oppSpecialUnused);
  const selfRevive = self.character?.id === 'madoka' ? proj.selfReviveMax : 0;
  const oppRevive = opp.character?.id === 'madoka' ? proj.oppReviveMax : 0;
  features.madokaReviveAdvantage = norm(selfRevive - oppRevive, 13);
  features.terminalWin = proj.terminalWin;
  features.terminalLoss = proj.terminalLoss;
  return features;
}

export function scoreEvaluationAction(adapter, playerIndex, action, genome = DEFAULT_GENOME) {
  const normalized = normalizeEvaluationGenome(genome);
  const features = actionFeatures(adapter, playerIndex, action);
  let score = 0;
  for (const name of FEATURE_NAMES) score += normalized.weights[name] * features[name];
  return { score, features };
}

export function inspectEvaluationActions(adapter, playerIndex = adapter.currentPlayer(), genome = DEFAULT_GENOME) {
  return adapter.legalActions(playerIndex).map(action => ({ action, ...scoreEvaluationAction(adapter, playerIndex, action, genome) }))
    .sort((a, b) => b.score - a.score || a.action - b.action);
}

export function chooseEvaluationAction(adapter, playerIndex = adapter.currentPlayer(), genome = DEFAULT_GENOME, rng = Math.random) {
  const ranked = inspectEvaluationActions(adapter, playerIndex, genome);
  if (!ranked.length) throw new Error('AI has no legal action.');
  const best = ranked[0].score;
  const tied = ranked.filter(item => Math.abs(item.score - best) < 1e-9);
  return tied[Math.floor(rng() * tied.length)].action;
}
