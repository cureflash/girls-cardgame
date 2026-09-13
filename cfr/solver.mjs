import { createHash } from 'node:crypto';
import { GameEngine, PHASES, CARD_TYPES } from '../src/game-engine.js';
import {
  ACTIONS,
  ATTACK_TARGETS,
  RL_LIMITS,
  RLAdapter,
  tributeMaskToSlots,
} from '../src/rl-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';

export const SOLVER_FORMAT = 'girls-cardgame-regret-policy-v4';
export const SOLVER_ALGORITHM = 'hierarchical-strategic-rollout-regret-matching';

export function seededRng(seed = 1) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const clip = (n, max = 2) => Math.min(max, Math.max(0, n ?? 0));
const deckBand = n => n <= 5 ? 0 : n <= 10 ? 1 : n <= 15 ? 2 : n <= 20 ? 3 : 4;
const handBand = n => n <= 2 ? 0 : n <= 5 ? 1 : n <= 8 ? 2 : 3;
const turnBand = n => n <= 2 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : 3;
const powerBand = n => n <= 0 ? 0 : n <= 5 ? 1 : n <= 10 ? 2 : n <= 15 ? 3 : n <= 25 ? 4 : 5;
const attackBand = n => n <= 0 ? 0 : n <= 5 ? 1 : n <= 8 ? 2 : n <= 10 ? 3 : 4;
const diffBand = n => n <= -5 ? -2 : n <= -2 ? -1 : n <= 1 ? 0 : n <= 4 ? 1 : 2;

function count(cards, predicate) {
  return cards.reduce((sum, card) => sum + Number(Boolean(card && predicate(card))), 0);
}

function handProfile(cards) {
  const familiars = cards.filter(card => card?.type === CARD_TYPES.FAMILIAR);
  const witches = cards.filter(card => card?.type === CARD_TYPES.WITCH);
  const boosts = cards.filter(card => card?.effect === 'boost');
  const familiarPower = familiars.reduce((sum, card) => sum + (card.attack ?? 0), 0);
  const boostPower = boosts.reduce((sum, card) => sum + (card.value ?? 0), 0);
  return {
    size: handBand(cards.length),
    familiarCount: clip(familiars.length, 3),
    familiarPower: powerBand(familiarPower),
    maxFamiliar: attackBand(familiars.reduce((best, card) => Math.max(best, card.attack ?? 0), 0)),
    maxWitch: attackBand(witches.reduce((best, card) => Math.max(best, card.attack ?? 0), 0)),
    shield: clip(count(cards, card => card.effect === 'nullifyDamage')),
    boostPower: powerBand(boostPower),
    hasBoost5: Number(boosts.some(card => card.value === 5)),
  };
}

function fieldProfile(field, turn) {
  const cards = field.filter(Boolean);
  const total = cards.reduce((sum, card) => sum + (card.attack ?? 0), 0);
  const ready = cards.filter(card => card.attackedTurn !== turn).length;
  return {
    count: clip(cards.length, 3),
    max: attackBand(cards.reduce((best, card) => Math.max(best, card.attack ?? 0), 0)),
    power: powerBand(total),
    ready: clip(ready, 3),
  };
}

function graveProfile(cards) {
  const monsters = cards.filter(card => [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card?.type));
  return {
    best: attackBand(monsters.reduce((best, card) => Math.max(best, card.attack ?? 0), 0)),
    has10: Number(monsters.some(card => card.attack === 10)),
    has13: Number(monsters.some(card => card.attack === 13)),
  };
}

function witchPlan(adapter, playerIndex, handIndex, tributeMask) {
  const p = adapter.engine.player(playerIndex);
  const card = p.hand[handIndex];
  if (!card || card.type !== CARD_TYPES.WITCH) return null;
  const slots = tributeMaskToSlots(tributeMask).sort((a, b) => a - b);
  const plan = adapter.engine.validTributeSets(playerIndex, card).find(candidate => {
    const cs = [...candidate.slots].sort((a, b) => a - b);
    return cs.length === slots.length && cs.every((slot, i) => slot === slots[i]);
  });
  if (!plan) return null;
  const fieldCards = slots.map(slot => p.field[slot]).filter(Boolean);
  return {
    total: plan.total,
    fieldCount: fieldCards.length,
    fieldPower: fieldCards.reduce((sum, tribute) => sum + (tribute.attack ?? 0), 0),
    handCount: plan.handIds.length,
  };
}

function decodeAction(adapter, action, playerIndex) {
  const p = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  if (action === ACTIONS.PASS) return { kind: 'pass' };
  if (action === ACTIONS.END_TURN) return { kind: 'end-turn' };
  if (action === ACTIONS.ENTER_BATTLE) return { kind: 'enter-battle' };
  if (action === ACTIONS.CONTINUE_BATTLE) return { kind: 'continue-battle' };
  if (action === ACTIONS.SPECIAL) return { kind: 'special', character: p.character?.id ?? 'unknown' };

  if (action >= ACTIONS.SUMMON_BASE && action < ACTIONS.ATTACK_BASE) {
    const offset = action - ACTIONS.SUMMON_BASE;
    const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
    const tributeMask = offset % RL_LIMITS.TRIBUTE_MASKS;
    const card = p.hand[handIndex];
    return {
      kind: 'summon',
      type: card?.type ?? null,
      attack: card?.attack ?? 0,
      plan: card?.type === CARD_TYPES.WITCH ? witchPlan(adapter, playerIndex, handIndex, tributeMask) : null,
    };
  }
  if (action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE) {
    const offset = action - ACTIONS.ATTACK_BASE;
    const attackerSlot = Math.floor(offset / ATTACK_TARGETS);
    const targetRaw = offset % ATTACK_TARGETS;
    return {
      kind: 'attack',
      attacker: p.field[attackerSlot]?.attack ?? 0,
      direct: targetRaw === RL_LIMITS.FIELD_SLOTS,
      defender: targetRaw === RL_LIMITS.FIELD_SLOTS ? 0 : (opp.field[targetRaw]?.attack ?? 0),
    };
  }
  if (action >= ACTIONS.MAIN_MAGIC_BASE && action < ACTIONS.CHAIN_BASE) {
    const card = p.hand[action - ACTIONS.MAIN_MAGIC_BASE];
    return { kind: 'main-magic', effect: card?.effect ?? 'unknown', value: card?.value ?? 0 };
  }
  if (action >= ACTIONS.CHAIN_BASE && action < ACTIONS.REVIVE_BASE) {
    const card = p.hand[action - ACTIONS.CHAIN_BASE];
    return { kind: 'chain', effect: card?.effect ?? 'unknown', value: card?.value ?? 0 };
  }
  if (action >= ACTIONS.REVIVE_BASE && action < ACTIONS.COUNT) {
    const card = p.graveyard[action - ACTIONS.REVIVE_BASE];
    return { kind: 'revive', attack: card?.attack ?? 0 };
  }
  return { kind: 'unknown', action };
}

function summonCost(decoded) {
  if (!decoded.plan) return 0;
  const overshoot = Math.max(0, decoded.plan.total - decoded.attack);
  return overshoot * 1000 + decoded.plan.fieldPower * 20 + decoded.plan.fieldCount * 10 + decoded.plan.handCount;
}

function chooseRepresentative(entries, score, maximize = true) {
  if (!entries.length) return null;
  return [...entries].sort((a, b) => {
    const delta = score(a) - score(b);
    return maximize ? -delta : delta;
  })[0];
}

function strategicOptions(adapter, playerIndex, legalActions = adapter.legalActions(playerIndex)) {
  const decoded = legalActions.map(action => ({ action, decoded: decodeAction(adapter, action, playerIndex) }));
  const options = new Map();
  const fixed = ['pass', 'end-turn', 'enter-battle', 'continue-battle'];
  for (const name of fixed) {
    const item = decoded.find(entry => entry.decoded.kind === name);
    if (item) options.set(name, item.action);
  }
  const special = decoded.find(entry => entry.decoded.kind === 'special');
  if (special) options.set('special', special.action);

  const familiars = decoded.filter(entry => entry.decoded.kind === 'summon' && entry.decoded.type === CARD_TYPES.FAMILIAR);
  if (familiars.length) {
    const low = chooseRepresentative(familiars, entry => entry.decoded.attack, false);
    const high = chooseRepresentative(familiars, entry => entry.decoded.attack, true);
    options.set('summon-familiar:low', low.action);
    if (high.action !== low.action) options.set('summon-familiar:high', high.action);
  }

  const witches = decoded.filter(entry => entry.decoded.kind === 'summon' && entry.decoded.type === CARD_TYPES.WITCH);
  if (witches.length) {
    const bestByAttack = new Map();
    for (const entry of witches) {
      const attack = entry.decoded.attack;
      const current = bestByAttack.get(attack);
      if (!current || summonCost(entry.decoded) < summonCost(current.decoded)) bestByAttack.set(attack, entry);
    }
    const unique = [...bestByAttack.values()];
    const low = chooseRepresentative(unique, entry => entry.decoded.attack, false);
    const high = chooseRepresentative(unique, entry => entry.decoded.attack, true);
    options.set('summon-witch:low', low.action);
    if (high.action !== low.action) options.set('summon-witch:high', high.action);
  }

  const direct = decoded.filter(entry => entry.decoded.kind === 'attack' && entry.decoded.direct);
  if (direct.length) {
    const high = chooseRepresentative(direct, entry => entry.decoded.attacker, true);
    const low = chooseRepresentative(direct, entry => entry.decoded.attacker, false);
    options.set('attack-direct:high', high.action);
    if (low.action !== high.action) options.set('attack-direct:low', low.action);
  }

  const battles = decoded.filter(entry => entry.decoded.kind === 'attack' && !entry.decoded.direct);
  if (battles.length) {
    const pressure = chooseRepresentative(battles, entry => {
      const { attacker, defender } = entry.decoded;
      return (attacker - defender) * 100 + attacker;
    }, true);
    const remove = chooseRepresentative(battles, entry => {
      const { attacker, defender } = entry.decoded;
      const kill = attacker >= defender ? 10000 : 0;
      const survive = attacker > defender ? 1000 : 0;
      return kill + survive + defender * 100 - Math.max(0, defender - attacker) * 20;
    }, true);
    options.set('attack-battle:pressure', pressure.action);
    if (remove.action !== pressure.action) options.set('attack-battle:remove', remove.action);
  }

  const chain = decoded.filter(entry => entry.decoded.kind === 'chain');
  const shield = chain.find(entry => entry.decoded.effect === 'nullifyDamage');
  if (shield) options.set('shield', shield.action);
  const boosts = chain.filter(entry => entry.decoded.effect === 'boost');
  if (boosts.length) {
    const small = chooseRepresentative(boosts, entry => entry.decoded.value, false);
    const large = chooseRepresentative(boosts, entry => entry.decoded.value, true);
    options.set('boost:small', small.action);
    if (large.action !== small.action) options.set('boost:large', large.action);
  }

  const mainMagic = decoded.filter(entry => entry.decoded.kind === 'main-magic');
  for (const entry of mainMagic) options.set(`main-magic:${entry.decoded.effect}`, entry.action);

  const revives = decoded.filter(entry => entry.decoded.kind === 'revive');
  if (revives.length) {
    const high = chooseRepresentative(revives, entry => entry.decoded.attack, true);
    const low = chooseRepresentative(revives, entry => entry.decoded.attack, false);
    options.set('revive:high', high.action);
    if (low.action !== high.action) options.set('revive:low', low.action);
  }

  return options;
}

export function actionDescriptor(adapter, action, playerIndex = adapter.currentPlayer()) {
  const options = strategicOptions(adapter, playerIndex);
  for (const [name, concrete] of options) if (concrete === action) return name;
  return decodeAction(adapter, action, playerIndex).kind;
}

function battleProfile(adapter, playerIndex) {
  const battle = adapter.engine.state.battle;
  if (!battle) return null;
  const selfAttacking = battle.attackerPlayer === playerIndex;
  const attack = (battle.attackerBase ?? 0) + (battle.attackerBonus ?? 0);
  const defend = (battle.defenderBase ?? 0) + (battle.defenderBonus ?? 0);
  const selfValue = selfAttacking ? attack : defend;
  const oppValue = selfAttacking ? defend : attack;
  const attacker = adapter.engine.player(battle.attackerPlayer);
  const followups = attacker.field.filter(card => card && card.attackedTurn !== adapter.engine.state.turn).length;
  return {
    role: selfAttacking ? 1 : 0,
    self: attackBand(selfValue),
    opp: attackBand(oppValue),
    diff: diffBand(selfValue - oppValue),
    followups: clip(followups, 3),
  };
}

function fineState(adapter, playerIndex, options) {
  const s = adapter.engine.state;
  const self = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  return {
    turn: turnBand(s.turn),
    phase: s.phase,
    pending: s.pendingDecision?.type ?? null,
    self: {
      character: self.character?.id ?? null,
      deck: deckBand(self.deck.length),
      hand: handProfile(self.hand),
      field: fieldProfile(self.field, s.turn),
      grave: graveProfile(self.graveyard),
      summoned: Number(Boolean(self.summonedThisTurn)),
      special: Number(Boolean(self.specialUsed)),
    },
    opp: {
      deck: deckBand(opp.deck.length),
      hand: handBand(opp.hand.length),
      field: fieldProfile(opp.field, s.turn),
      grave: graveProfile(opp.graveyard),
      special: Number(Boolean(opp.specialUsed)),
    },
    battle: battleProfile(adapter, playerIndex),
    options: [...options.keys()].sort(),
  };
}

function backoffState(adapter, playerIndex, options) {
  const s = adapter.engine.state;
  const self = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  return {
    phase: s.phase,
    pending: s.pendingDecision?.type ?? null,
    character: self.character?.id ?? null,
    selfDeck: deckBand(self.deck.length),
    oppDeck: deckBand(opp.deck.length),
    selfField: fieldProfile(self.field, s.turn).count,
    oppField: fieldProfile(opp.field, s.turn).count,
    selfSpecial: Number(Boolean(self.specialUsed)),
    oppSpecial: Number(Boolean(opp.specialUsed)),
    battleDiff: battleProfile(adapter, playerIndex)?.diff ?? null,
    options: [...options.keys()].sort(),
  };
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

export function informationKey(adapter, playerIndex = adapter.currentPlayer(), legalActions = adapter.legalActions(playerIndex)) {
  return hash(fineState(adapter, playerIndex, strategicOptions(adapter, playerIndex, legalActions)));
}

export function visibleSummary(adapter, playerIndex = adapter.currentPlayer()) {
  return fineState(adapter, playerIndex, strategicOptions(adapter, playerIndex));
}

export function cloneAdapter(adapter) {
  const source = adapter.engine;
  const engine = Object.create(Object.getPrototypeOf(source));
  engine.rng = source.rng;
  engine.state = structuredClone(source.state);
  return new RLAdapter(engine);
}

export function createMatch(seed = 1, swapped = false) {
  const ids = swapped ? ['mami', 'madoka'] : ['madoka', 'mami'];
  return new RLAdapter(new GameEngine({
    players: ids.map((id, index) => ({ id: `p${index}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng: seededRng(seed),
  }));
}

function normalize(weights, actions) {
  const positive = actions.map(action => Math.max(0, weights.get(action) ?? 0));
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return new Map(actions.map(action => [action, 1 / actions.length]));
  return new Map(actions.map((action, i) => [action, positive[i] / total]));
}

function mixUniform(strategy, epsilon) {
  if (epsilon <= 0) return strategy;
  const n = strategy.size;
  return new Map([...strategy].map(([action, p]) => [action, (1 - epsilon) * p + epsilon / n]));
}

function sampleFrom(strategy, rng) {
  let r = rng();
  let last = null;
  for (const [action, probability] of strategy) {
    last = action;
    r -= probability;
    if (r <= 0) return action;
  }
  return last;
}

function terminalValue(adapter, perspective) {
  if (adapter.engine.state.phase !== PHASES.GAME_OVER) return null;
  const winner = adapter.engine.state.winner;
  if (winner === null || winner === undefined) return 0;
  return winner === perspective ? 1 : -1;
}

function cutoffValue(adapter, perspective) {
  const self = adapter.engine.player(perspective);
  const opp = adapter.engine.player(adapter.engine.opponent(perspective));
  const board = player => player.field.reduce((sum, card) => sum + (card?.attack ?? 0), 0);
  const deckTerm = (self.deck.length - opp.deck.length) / 30;
  const boardTerm = (board(self) - board(opp)) / 65;
  const handTerm = (self.hand.length - opp.hand.length) / 30;
  return Math.max(-0.95, Math.min(0.95, 0.72 * deckTerm + 0.20 * boardTerm + 0.08 * handTerm));
}

function newNode(key, character, actions, summary) {
  return {
    key,
    character,
    visits: 0,
    regrets: new Map(actions.map(action => [action, 0])),
    strategySum: new Map(actions.map(action => [action, 0])),
    summary,
  };
}

function averageStrategy(node, actions) {
  const total = actions.reduce((sum, action) => sum + (node.strategySum.get(action) ?? 0), 0);
  if (total <= 0) return normalize(node.regrets, actions);
  return new Map(actions.map(action => [action, (node.strategySum.get(action) ?? 0) / total]));
}

export class RegretSolver {
  constructor({ seed = 1, exploration = 0.08, rolloutsPerAction = 1, maxActions = 260, fallback = 'baseline' } = {}) {
    this.seed = seed;
    this.exploration = exploration;
    this.rolloutsPerAction = rolloutsPerAction;
    this.maxActions = maxActions;
    this.fallback = fallback;
    this.nodes = new Map();
    this.backoffNodes = new Map();
    this.training = { games: 0, madokaWins: 0, mamiWins: 0, draws: 0, cutoffs: 0, decisions: 0 };
  }

  ensureNodes(adapter, playerIndex, options) {
    const actions = [...options.keys()].sort();
    const fine = fineState(adapter, playerIndex, options);
    const backoff = backoffState(adapter, playerIndex, options);
    const fineKey = hash(fine);
    const backoffKey = hash(backoff);
    const character = adapter.engine.player(playerIndex).character?.id ?? null;
    if (!this.nodes.has(fineKey)) this.nodes.set(fineKey, newNode(fineKey, character, actions, fine));
    if (!this.backoffNodes.has(backoffKey)) this.backoffNodes.set(backoffKey, newNode(backoffKey, character, actions, backoff));
    return { fine: this.nodes.get(fineKey), backoff: this.backoffNodes.get(backoffKey), actions };
  }

  strategyBundle(adapter, playerIndex, options, { average = false } = {}) {
    const actions = [...options.keys()].sort();
    const fineKey = hash(fineState(adapter, playerIndex, options));
    const backoffKey = hash(backoffState(adapter, playerIndex, options));
    const fine = this.nodes.get(fineKey);
    if (fine) return { strategy: average ? averageStrategy(fine, actions) : normalize(fine.regrets, actions), source: 'fine' };
    const backoff = this.backoffNodes.get(backoffKey);
    if (backoff) return { strategy: average ? averageStrategy(backoff, actions) : normalize(backoff.regrets, actions), source: 'backoff' };

    if (this.fallback === 'baseline') {
      const legal = [...options.values()];
      const baseline = chooseBaselineAction(adapter, playerIndex);
      const semantic = [...options].find(([, action]) => action === baseline)?.[0];
      if (semantic) return { strategy: new Map(actions.map(action => [action, action === semantic ? 1 : 0])), source: 'baseline' };
      if (legal.includes(baseline)) return { strategy: new Map(actions.map(action => [action, 1 / actions.length])), source: 'baseline' };
    }
    return { strategy: new Map(actions.map(action => [action, 1 / actions.length])), source: 'uniform' };
  }

  choose(adapter, playerIndex, rng, { average = false, exploration = 0 } = {}) {
    const legal = adapter.legalActions(playerIndex);
    if (!legal.length) throw new Error(`No legal actions for player ${playerIndex}`);
    const options = strategicOptions(adapter, playerIndex, legal);
    if (options.size === 1) {
      const [semantic, action] = [...options][0];
      return { semantic, action, source: 'forced' };
    }
    const bundle = this.strategyBundle(adapter, playerIndex, options, { average });
    const semantic = sampleFrom(mixUniform(bundle.strategy, exploration), rng);
    return { semantic, action: options.get(semantic), source: bundle.source };
  }

  rollout(adapter, perspective, rng) {
    for (let step = 0; step < this.maxActions; step++) {
      const terminal = terminalValue(adapter, perspective);
      if (terminal !== null) return terminal;
      const player = adapter.currentPlayer();
      const legal = adapter.legalActions(player);
      if (!legal.length) return cutoffValue(adapter, perspective);
      const action = legal.length === 1 ? legal[0] : this.choose(adapter, player, rng).action;
      adapter.applyAction(action, player);
    }
    this.training.cutoffs += 1;
    return cutoffValue(adapter, perspective);
  }

  evaluateOptions(adapter, playerIndex, options, rng) {
    const values = new Map();
    for (const [semantic, action] of options) {
      let value = 0;
      for (let rollout = 0; rollout < this.rolloutsPerAction; rollout++) {
        const child = cloneAdapter(adapter);
        child.applyAction(action, playerIndex);
        value += this.rollout(child, playerIndex, rng);
      }
      values.set(semantic, value / this.rolloutsPerAction);
    }
    return values;
  }

  updateNode(node, actions, strategy, values, baseline) {
    for (const action of actions) {
      node.regrets.set(action, (node.regrets.get(action) ?? 0) + values.get(action) - baseline);
      node.strategySum.set(action, (node.strategySum.get(action) ?? 0) + (strategy.get(action) ?? 0));
    }
    node.visits += 1;
  }

  train({ iterations = 100, seed = this.seed } = {}) {
    const rng = seededRng(seed ^ 0xa5a5a5a5);
    for (let iteration = 0; iteration < iterations; iteration++) {
      const adapter = createMatch(seed + iteration * 104729, iteration % 2 === 1);
      for (let step = 0; step < this.maxActions; step++) {
        if (adapter.engine.state.phase === PHASES.GAME_OVER) break;
        const player = adapter.currentPlayer();
        const legal = adapter.legalActions(player);
        if (!legal.length) break;
        const options = strategicOptions(adapter, player, legal);
        if (options.size === 1) {
          adapter.applyAction([...options.values()][0], player);
          continue;
        }
        const { fine, backoff, actions } = this.ensureNodes(adapter, player, options);
        const prior = fine.visits > 0 ? normalize(fine.regrets, actions) : (backoff.visits > 0 ? normalize(backoff.regrets, actions) : new Map(actions.map(action => [action, 1 / actions.length])));
        const values = this.evaluateOptions(adapter, player, options, rng);
        const baseline = actions.reduce((sum, action) => sum + (prior.get(action) ?? 0) * values.get(action), 0);
        this.updateNode(fine, actions, prior, values, baseline);
        this.updateNode(backoff, actions, prior, values, baseline);
        this.training.decisions += 1;
        const semantic = sampleFrom(mixUniform(prior, this.exploration), rng);
        adapter.applyAction(options.get(semantic), player);
      }
      const winner = adapter.engine.state.winner;
      if (winner === null || winner === undefined) this.training.draws += 1;
      else if (adapter.engine.player(winner).character?.id === 'madoka') this.training.madokaWins += 1;
      else this.training.mamiWins += 1;
      this.training.games += 1;
    }
    return this.training;
  }

  playPolicyGame({ seed, swapped = false, solverCharacter = null, average = true, baselineOpponent = false } = {}) {
    const adapter = createMatch(seed, swapped);
    const rng = seededRng(seed ^ 0x9e3779b9);
    const sourceCounts = { fine: 0, backoff: 0, baseline: 0, uniform: 0, forced: 0 };
    const actionCounts = {};
    let solverDecisions = 0;
    for (let step = 0; step < this.maxActions; step++) {
      if (adapter.engine.state.phase === PHASES.GAME_OVER) break;
      const player = adapter.currentPlayer();
      const legal = adapter.legalActions(player);
      if (!legal.length) break;
      const character = adapter.engine.player(player).character?.id;
      let action;
      if (baselineOpponent && character !== solverCharacter) action = chooseBaselineAction(adapter, player);
      else {
        const chosen = this.choose(adapter, player, rng, { average });
        action = chosen.action;
        sourceCounts[chosen.source] = (sourceCounts[chosen.source] ?? 0) + 1;
        if (chosen.source !== 'forced') solverDecisions += 1;
        actionCounts[chosen.semantic] = (actionCounts[chosen.semantic] ?? 0) + 1;
      }
      adapter.applyAction(action, player);
    }
    const winner = adapter.engine.state.winner;
    return {
      winnerCharacter: winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id,
      terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
      solverDecisions,
      sourceCounts,
      actionCounts,
    };
  }

  evaluateVsBaseline(character, { games = 100, seed = this.seed + 900000 } = {}) {
    const totals = { character, games, wins: 0, losses: 0, draws: 0, terminated: 0, solverDecisions: 0, sourceCounts: { fine: 0, backoff: 0, baseline: 0, uniform: 0, forced: 0 }, actionCounts: {} };
    for (let game = 0; game < games; game++) {
      const swapped = character === 'madoka' ? game % 2 === 1 : game % 2 === 0;
      const result = this.playPolicyGame({ seed: seed + game * 65537, swapped, solverCharacter: character, average: true, baselineOpponent: true });
      if (result.terminated) totals.terminated += 1;
      if (result.winnerCharacter === character) totals.wins += 1;
      else if (result.winnerCharacter === null) totals.draws += 1;
      else totals.losses += 1;
      totals.solverDecisions += result.solverDecisions;
      for (const [key, value] of Object.entries(result.sourceCounts)) totals.sourceCounts[key] = (totals.sourceCounts[key] ?? 0) + value;
      for (const [key, value] of Object.entries(result.actionCounts)) totals.actionCounts[key] = (totals.actionCounts[key] ?? 0) + value;
    }
    totals.winRate = totals.wins / games;
    const learned = totals.sourceCounts.fine + totals.sourceCounts.backoff;
    const evaluated = learned + totals.sourceCounts.baseline + totals.sourceCounts.uniform;
    totals.learnedCoverage = evaluated ? learned / evaluated : 0;
    totals.fineCoverage = evaluated ? totals.sourceCounts.fine / evaluated : 0;
    totals.baselineFallbackRate = evaluated ? totals.sourceCounts.baseline / evaluated : 0;
    return totals;
  }

  nodeList(map, limit = 30) {
    return [...map.values()].sort((a, b) => b.visits - a.visits).slice(0, limit).map(node => {
      const actions = [...node.regrets.keys()];
      const strategy = averageStrategy(node, actions);
      return {
        key: node.key,
        character: node.character,
        visits: node.visits,
        summary: node.summary,
        strategy: actions.map(action => ({ action, label: action, probability: strategy.get(action) ?? 0, regret: node.regrets.get(action) ?? 0 })).sort((a, b) => b.probability - a.probability),
      };
    });
  }

  topInformationSets(limit = 30) {
    return this.nodeList(this.nodes, limit);
  }

  report({ evaluationGames = 100, top = 30 } = {}) {
    const madoka = this.evaluateVsBaseline('madoka', { games: evaluationGames });
    const mami = this.evaluateVsBaseline('mami', { games: evaluationGames, seed: this.seed + 1900000 });
    const threshold = 0.8;
    return {
      format: SOLVER_FORMAT,
      algorithm: SOLVER_ALGORITHM,
      exactNash: false,
      approximation: 'Hierarchical strategic information-set abstraction with Monte Carlo rollout regret matching. Hidden opponent hand identities and deck orders are excluded. Concrete cards/actions are compressed to strategic choices such as low/high summon, pressure/remove attack, shield, small/large boost, special, and high/low revive.',
      config: { seed: this.seed, exploration: this.exploration, rolloutsPerAction: this.rolloutsPerAction, maxActions: this.maxActions, fallback: this.fallback },
      training: { ...this.training, informationSets: this.nodes.size, backoffSets: this.backoffNodes.size },
      evaluation: { madokaVsBaselineMami: madoka, mamiVsBaselineMadoka: mami },
      coverageGate: { threshold, passed: madoka.learnedCoverage >= threshold && mami.learnedCoverage >= threshold },
      topInformationSets: this.nodeList(this.nodes, top),
      topBackoffPolicies: this.nodeList(this.backoffNodes, top),
    };
  }
}
