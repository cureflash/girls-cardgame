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

export const SOLVER_FORMAT = 'girls-cardgame-regret-policy-v3';
export const SOLVER_ALGORITHM = 'bucketed-information-set-rollout-regret-matching';

export function seededRng(seed = 1) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const clip = (n, max = 2) => Math.min(max, Math.max(0, n ?? 0));
const count = (cards, predicate) => cards.reduce((n, card) => n + Number(Boolean(card && predicate(card))), 0);
const deckBucket = n => n <= 3 ? 0 : n <= 7 ? 1 : n <= 11 ? 2 : n <= 15 ? 3 : n <= 20 ? 4 : 5;
const handBucket = n => n <= 2 ? 0 : n <= 5 ? 1 : n <= 8 ? 2 : 3;
const turnBucket = n => n <= 2 ? 0 : n <= 4 ? 1 : n <= 8 ? 2 : n <= 12 ? 3 : 4;

function handProfile(cards) {
  const familiars = cards.filter(card => card?.type === CARD_TYPES.FAMILIAR);
  const witches = cards.filter(card => card?.type === CARD_TYPES.WITCH);
  const boosts = cards.filter(card => card?.effect === 'boost');
  return {
    size: handBucket(cards.length),
    f3: clip(count(familiars, card => card.attack === 3)),
    f4: clip(count(familiars, card => card.attack === 4)),
    f5: clip(count(familiars, card => card.attack === 5)),
    familiarCount: clip(familiars.length, 3),
    familiarPower: Math.min(4, Math.floor(familiars.reduce((sum, card) => sum + (card.attack ?? 0), 0) / 5)),
    w8: clip(count(witches, card => card.attack === 8)),
    w10: clip(count(witches, card => card.attack === 10)),
    w13: clip(count(witches, card => card.attack === 13)),
    b2: clip(count(boosts, card => card.value === 2)),
    b3: clip(count(boosts, card => card.value === 3)),
    b5: clip(count(boosts, card => card.value === 5)),
    shield: clip(count(cards, card => card.effect === 'nullifyDamage')),
  };
}

function graveProfile(cards) {
  const monsters = cards.filter(card => [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card?.type));
  return {
    m3: clip(count(monsters, card => card.attack === 3)),
    m4: clip(count(monsters, card => card.attack === 4)),
    m5: clip(count(monsters, card => card.attack === 5)),
    m8: clip(count(monsters, card => card.attack === 8)),
    m10: clip(count(monsters, card => card.attack === 10)),
    m13: clip(count(monsters, card => card.attack === 13)),
    best: monsters.reduce((best, card) => Math.max(best, card.attack ?? 0), 0),
  };
}

function fieldProfile(field, turn) {
  return field
    .filter(Boolean)
    .map(card => [card.attack ?? 0, card.attackedTurn === turn ? 1 : 0])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function witchPlanForAction(adapter, playerIndex, handIndex, tributeMask) {
  const p = adapter.engine.player(playerIndex);
  const card = p.hand[handIndex];
  if (!card || card.type !== CARD_TYPES.WITCH) return null;
  const slots = tributeMaskToSlots(tributeMask).sort((a, b) => a - b);
  const plan = adapter.engine.validTributeSets(playerIndex, card)
    .find(candidate => {
      const candidateSlots = [...candidate.slots].sort((a, b) => a - b);
      return candidateSlots.length === slots.length && candidateSlots.every((slot, i) => slot === slots[i]);
    });
  if (!plan) return null;
  const fieldCards = slots.map(slot => p.field[slot]).filter(Boolean);
  const handCards = plan.handIds.map(id => p.hand.find(candidate => candidate.id === id)).filter(Boolean);
  return {
    slots,
    total: plan.total,
    fieldCount: fieldCards.length,
    fieldPower: fieldCards.reduce((sum, tribute) => sum + (tribute.attack ?? 0), 0),
    handCount: handCards.length,
  };
}

export function actionDescriptor(adapter, action, playerIndex = adapter.currentPlayer()) {
  const p = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  if (action === ACTIONS.PASS) return 'pass';
  if (action === ACTIONS.END_TURN) return 'end-turn';
  if (action === ACTIONS.ENTER_BATTLE) return 'enter-battle';
  if (action === ACTIONS.CONTINUE_BATTLE) return 'continue-battle';
  if (action === ACTIONS.SPECIAL) return `special:${p.character?.id ?? 'unknown'}`;

  if (action >= ACTIONS.SUMMON_BASE && action < ACTIONS.ATTACK_BASE) {
    const offset = action - ACTIONS.SUMMON_BASE;
    const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
    const tributeMask = offset % RL_LIMITS.TRIBUTE_MASKS;
    const card = p.hand[handIndex];
    if (!card) return 'summon:missing';
    if (card.type === CARD_TYPES.FAMILIAR) return `summon:familiar:${card.attack ?? 0}`;
    const plan = witchPlanForAction(adapter, playerIndex, handIndex, tributeMask);
    return `summon:witch:${card.attack ?? 0}:field${Math.min(2, plan?.fieldCount ?? 0)}`;
  }

  if (action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE) {
    const offset = action - ACTIONS.ATTACK_BASE;
    const attackerSlot = Math.floor(offset / ATTACK_TARGETS);
    const targetRaw = offset % ATTACK_TARGETS;
    const attacker = p.field[attackerSlot];
    if (targetRaw === RL_LIMITS.FIELD_SLOTS) return `attack:direct:${attacker?.attack ?? 0}`;
    return `attack:battle:${attacker?.attack ?? 0}->${opp.field[targetRaw]?.attack ?? 0}`;
  }

  if (action >= ACTIONS.MAIN_MAGIC_BASE && action < ACTIONS.CHAIN_BASE) {
    const card = p.hand[action - ACTIONS.MAIN_MAGIC_BASE];
    return `main-magic:${card?.effect ?? 'unknown'}:${card?.value ?? 0}`;
  }
  if (action >= ACTIONS.CHAIN_BASE && action < ACTIONS.REVIVE_BASE) {
    const card = p.hand[action - ACTIONS.CHAIN_BASE];
    if (card?.effect === 'nullifyDamage') return 'chain:shield';
    if (card?.effect === 'boost') return `chain:boost:${card.value ?? 0}`;
    return `chain:${card?.effect ?? 'unknown'}`;
  }
  if (action >= ACTIONS.REVIVE_BASE && action < ACTIONS.COUNT) {
    const card = p.graveyard[action - ACTIONS.REVIVE_BASE];
    return `revive:${card?.attack ?? 0}`;
  }
  return `action:${action}`;
}

function concreteCost(adapter, action, playerIndex) {
  if (action < ACTIONS.SUMMON_BASE || action >= ACTIONS.ATTACK_BASE) return action;
  const offset = action - ACTIONS.SUMMON_BASE;
  const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
  const tributeMask = offset % RL_LIMITS.TRIBUTE_MASKS;
  const card = adapter.engine.player(playerIndex).hand[handIndex];
  if (card?.type !== CARD_TYPES.WITCH) return handIndex;
  const plan = witchPlanForAction(adapter, playerIndex, handIndex, tributeMask);
  if (!plan) return 1e9;
  const overshoot = Math.max(0, plan.total - (card.tributeThreshold ?? 0));
  return overshoot * 1000 + plan.fieldPower * 20 + plan.fieldCount * 10 + plan.handCount;
}

function actionGroups(adapter, playerIndex, legalActions) {
  const groups = new Map();
  for (const action of legalActions) {
    const semantic = actionDescriptor(adapter, action, playerIndex);
    if (!groups.has(semantic)) groups.set(semantic, []);
    groups.get(semantic).push(action);
  }
  for (const actions of groups.values()) actions.sort((a, b) => concreteCost(adapter, a, playerIndex) - concreteCost(adapter, b, playerIndex));
  return groups;
}

function visibleState(adapter, playerIndex, legalActions) {
  const s = adapter.engine.state;
  const self = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  const battle = s.battle;
  return {
    turn: turnBucket(s.turn),
    phase: s.phase,
    active: s.activePlayer === playerIndex,
    priority: s.priorityPlayer === playerIndex,
    pending: s.pendingDecision?.type ?? null,
    battlePhaseEnded: Boolean(s.battlePhaseEnded),
    self: {
      character: self.character?.id ?? null,
      deck: deckBucket(self.deck.length),
      hand: handProfile(self.hand),
      field: fieldProfile(self.field, s.turn),
      grave: graveProfile(self.graveyard),
      summoned: Boolean(self.summonedThisTurn),
      special: Boolean(self.specialUsed),
    },
    opponent: {
      character: opp.character?.id ?? null,
      deck: deckBucket(opp.deck.length),
      hand: handBucket(opp.hand.length),
      field: fieldProfile(opp.field, s.turn),
      grave: graveProfile(opp.graveyard),
      special: Boolean(opp.specialUsed),
    },
    battle: battle ? {
      selfAttacking: battle.attackerPlayer === playerIndex,
      direct: Boolean(battle.direct),
      attack: (battle.attackerBase ?? 0) + (battle.attackerBonus ?? 0),
      defend: (battle.defenderBase ?? 0) + (battle.defenderBonus ?? 0),
      selfPrevented: Boolean(battle.damagePrevented?.[playerIndex]),
      opponentPrevented: Boolean(battle.damagePrevented?.[adapter.engine.opponent(playerIndex)]),
    } : null,
    chain: s.chain.map(item => [item.player === playerIndex ? 1 : 0, item.card?.effect ?? null, item.card?.value ?? 0]),
    legal: [...actionGroups(adapter, playerIndex, legalActions).keys()].sort(),
  };
}

export function informationKey(adapter, playerIndex = adapter.currentPlayer(), legalActions = adapter.legalActions(playerIndex)) {
  return createHash('sha256').update(JSON.stringify(visibleState(adapter, playerIndex, legalActions))).digest('base64url');
}

export function visibleSummary(adapter, playerIndex = adapter.currentPlayer()) {
  const s = adapter.engine.state;
  const self = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  return {
    turnBucket: turnBucket(s.turn),
    phase: s.phase,
    character: self.character?.id ?? null,
    ownDeckBucket: deckBucket(self.deck.length),
    opponentDeckBucket: deckBucket(opp.deck.length),
    ownHand: handProfile(self.hand),
    ownField: fieldProfile(self.field, s.turn),
    opponentField: fieldProfile(opp.field, s.turn),
    ownGrave: graveProfile(self.graveyard),
    opponentGrave: graveProfile(opp.graveyard),
    ownSpecialUsed: Boolean(self.specialUsed),
    opponentSpecialUsed: Boolean(opp.specialUsed),
    pending: s.pendingDecision?.type ?? null,
  };
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

function mixUniform(strategy, epsilon) {
  if (epsilon <= 0) return strategy;
  const n = strategy.size;
  return new Map([...strategy].map(([action, probability]) => [action, (1 - epsilon) * probability + epsilon / n]));
}

function actionClass(descriptor) {
  if (descriptor.startsWith('summon:familiar')) return 'summon-familiar';
  if (descriptor.startsWith('summon:witch')) return 'summon-witch';
  if (descriptor.startsWith('attack:direct')) return 'attack-direct';
  if (descriptor.startsWith('attack:battle')) return 'attack-battle';
  if (descriptor === 'chain:shield') return 'shield';
  if (descriptor.startsWith('chain:boost')) return 'boost';
  if (descriptor.startsWith('special:')) return 'special';
  if (descriptor.startsWith('revive:')) return 'revive';
  if (descriptor.startsWith('main-magic:')) return 'main-magic';
  return descriptor;
}

function terminalValue(adapter, perspective) {
  if (adapter.engine.state.phase !== PHASES.GAME_OVER) return null;
  if (adapter.engine.state.winner === null || adapter.engine.state.winner === undefined) return 0;
  return adapter.engine.state.winner === perspective ? 1 : -1;
}

function cutoffValue(adapter, perspective) {
  const self = adapter.engine.player(perspective);
  const opp = adapter.engine.player(adapter.engine.opponent(perspective));
  const boardPower = player => player.field.reduce((sum, card) => sum + (card?.attack ?? 0), 0);
  const deck = (self.deck.length - opp.deck.length) / 30;
  const board = (boardPower(self) - boardPower(opp)) / 65;
  const hand = (self.hand.length - opp.hand.length) / 30;
  return Math.max(-0.95, Math.min(0.95, 0.72 * deck + 0.20 * board + 0.08 * hand));
}

function concreteForSemantic(groups, semantic) {
  const options = groups.get(semantic) ?? [];
  if (!options.length) throw new Error(`No concrete action for ${semantic}`);
  return options[0];
}

function baselineSemantic(adapter, playerIndex, legalActions) {
  const chosen = chooseBaselineAction(adapter, playerIndex);
  return legalActions.includes(chosen) ? actionDescriptor(adapter, chosen, playerIndex) : null;
}

export class RegretSolver {
  constructor({ seed = 1, exploration = 0.08, rolloutsPerAction = 1, maxActions = 260, fallback = 'baseline' } = {}) {
    this.seed = seed;
    this.exploration = exploration;
    this.rolloutsPerAction = rolloutsPerAction;
    this.maxActions = maxActions;
    this.fallback = fallback;
    this.nodes = new Map();
    this.training = { games: 0, madokaWins: 0, mamiWins: 0, draws: 0, cutoffs: 0, decisions: 0 };
  }

  ensureNode(adapter, playerIndex, legalActions) {
    const groups = actionGroups(adapter, playerIndex, legalActions);
    const semantics = [...groups.keys()].sort();
    const key = informationKey(adapter, playerIndex, legalActions);
    let node = this.nodes.get(key);
    if (!node) {
      node = {
        key,
        character: adapter.engine.player(playerIndex).character?.id ?? null,
        visits: 0,
        regrets: new Map(semantics.map(action => [action, 0])),
        strategySum: new Map(semantics.map(action => [action, 0])),
        summary: visibleSummary(adapter, playerIndex),
      };
      this.nodes.set(key, node);
    }
    return { node, groups, semantics };
  }

  strategyBundle(adapter, playerIndex, legalActions, { average = false } = {}) {
    const groups = actionGroups(adapter, playerIndex, legalActions);
    const semantics = [...groups.keys()].sort();
    const key = informationKey(adapter, playerIndex, legalActions);
    const node = this.nodes.get(key);
    if (node) {
      if (average) {
        const total = [...node.strategySum.values()].reduce((sum, value) => sum + value, 0);
        if (total > 0) {
          return { key, groups, semantics, fallback: false, strategy: new Map(semantics.map(action => [action, (node.strategySum.get(action) ?? 0) / total])) };
        }
      }
      return { key, groups, semantics, fallback: false, strategy: normalize(node.regrets, semantics) };
    }
    if (this.fallback === 'baseline') {
      const prior = baselineSemantic(adapter, playerIndex, legalActions);
      if (prior && groups.has(prior)) {
        return { key, groups, semantics, fallback: true, strategy: new Map(semantics.map(action => [action, action === prior ? 1 : 0])) };
      }
    }
    return { key, groups, semantics, fallback: true, strategy: normalize(new Map(), semantics) };
  }

  choose(adapter, playerIndex, rng, { average = false, exploration = 0 } = {}) {
    const legal = adapter.legalActions(playerIndex);
    if (!legal.length) throw new Error(`No legal actions for player ${playerIndex}`);
    if (legal.length === 1) return { action: legal[0], semantic: actionDescriptor(adapter, legal[0], playerIndex), fallback: false };
    const bundle = this.strategyBundle(adapter, playerIndex, legal, { average });
    const semantic = sampleFrom(mixUniform(bundle.strategy, exploration), rng);
    return { action: concreteForSemantic(bundle.groups, semantic), semantic, fallback: bundle.fallback };
  }

  rollout(adapter, perspective, rng) {
    for (let actions = 0; actions < this.maxActions; actions++) {
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

  evaluateSemanticActions(adapter, playerIndex, groups, semantics, rng) {
    const values = new Map();
    for (const semantic of semantics) {
      let total = 0;
      for (let rollout = 0; rollout < this.rolloutsPerAction; rollout++) {
        const child = cloneAdapter(adapter);
        child.applyAction(concreteForSemantic(groups, semantic), playerIndex);
        total += this.rollout(child, playerIndex, rng);
      }
      values.set(semantic, total / this.rolloutsPerAction);
    }
    return values;
  }

  train({ iterations = 100, seed = this.seed } = {}) {
    const rng = seededRng(seed ^ 0xa5a5a5a5);
    for (let iteration = 0; iteration < iterations; iteration++) {
      const adapter = createMatch(seed + iteration * 104729, iteration % 2 === 1);
      for (let actions = 0; actions < this.maxActions; actions++) {
        if (adapter.engine.state.phase === PHASES.GAME_OVER) break;
        const player = adapter.currentPlayer();
        const legal = adapter.legalActions(player);
        if (!legal.length) break;
        if (legal.length === 1) {
          adapter.applyAction(legal[0], player);
          continue;
        }
        const { node, groups, semantics } = this.ensureNode(adapter, player, legal);
        const strategy = normalize(node.regrets, semantics);
        const values = this.evaluateSemanticActions(adapter, player, groups, semantics, rng);
        const baseline = semantics.reduce((sum, semantic) => sum + (strategy.get(semantic) ?? 0) * values.get(semantic), 0);
        for (const semantic of semantics) {
          node.regrets.set(semantic, (node.regrets.get(semantic) ?? 0) + values.get(semantic) - baseline);
          node.strategySum.set(semantic, (node.strategySum.get(semantic) ?? 0) + (strategy.get(semantic) ?? 0));
        }
        node.visits += 1;
        this.training.decisions += 1;
        const semantic = sampleFrom(mixUniform(strategy, this.exploration), rng);
        adapter.applyAction(concreteForSemantic(groups, semantic), player);
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
    const actionCounts = {};
    let solverDecisions = 0;
    let fallbackDecisions = 0;
    for (let actions = 0; actions < this.maxActions; actions++) {
      if (adapter.engine.state.phase === PHASES.GAME_OVER) break;
      const player = adapter.currentPlayer();
      const legal = adapter.legalActions(player);
      if (!legal.length) break;
      const character = adapter.engine.player(player).character?.id;
      let action;
      let semantic;
      if (baselineOpponent && character !== solverCharacter) {
        action = chooseBaselineAction(adapter, player);
        semantic = actionDescriptor(adapter, action, player);
      } else if (legal.length === 1) {
        action = legal[0];
        semantic = actionDescriptor(adapter, action, player);
      } else {
        const chosen = this.choose(adapter, player, rng, { average });
        action = chosen.action;
        semantic = chosen.semantic;
        solverDecisions += 1;
        if (chosen.fallback) fallbackDecisions += 1;
        const cls = actionClass(semantic);
        actionCounts[cls] = (actionCounts[cls] ?? 0) + 1;
      }
      adapter.applyAction(action, player);
    }
    const winner = adapter.engine.state.winner;
    return {
      winner,
      winnerCharacter: winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id,
      terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
      turn: adapter.engine.state.turn,
      solverDecisions,
      fallbackDecisions,
      actionCounts,
    };
  }

  evaluateVsBaseline(character, { games = 100, seed = this.seed + 900000 } = {}) {
    const totals = { character, games, wins: 0, losses: 0, draws: 0, terminated: 0, solverDecisions: 0, fallbackDecisions: 0, actionCounts: {} };
    for (let game = 0; game < games; game++) {
      const swapped = character === 'madoka' ? game % 2 === 1 : game % 2 === 0;
      const result = this.playPolicyGame({ seed: seed + game * 65537, swapped, solverCharacter: character, average: true, baselineOpponent: true });
      if (result.terminated) totals.terminated += 1;
      if (result.winnerCharacter === character) totals.wins += 1;
      else if (result.winnerCharacter === null) totals.draws += 1;
      else totals.losses += 1;
      totals.solverDecisions += result.solverDecisions;
      totals.fallbackDecisions += result.fallbackDecisions;
      for (const [key, value] of Object.entries(result.actionCounts)) totals.actionCounts[key] = (totals.actionCounts[key] ?? 0) + value;
    }
    totals.winRate = totals.wins / games;
    totals.fallbackRate = totals.solverDecisions ? totals.fallbackDecisions / totals.solverDecisions : 0;
    totals.coverage = 1 - totals.fallbackRate;
    return totals;
  }

  topInformationSets(limit = 30) {
    return [...this.nodes.values()]
      .sort((a, b) => b.visits - a.visits)
      .slice(0, limit)
      .map(node => {
        const total = [...node.strategySum.values()].reduce((sum, value) => sum + value, 0);
        return {
          key: node.key,
          character: node.character,
          visits: node.visits,
          summary: node.summary,
          strategy: [...node.regrets.keys()].map(action => ({
            action,
            label: action,
            probability: total > 0 ? (node.strategySum.get(action) ?? 0) / total : 0,
            regret: node.regrets.get(action) ?? 0,
          })).sort((a, b) => b.probability - a.probability || b.regret - a.regret),
        };
      });
  }

  report({ evaluationGames = 100, top = 30 } = {}) {
    const madoka = this.evaluateVsBaseline('madoka', { games: evaluationGames });
    const mami = this.evaluateVsBaseline('mami', { games: evaluationGames, seed: this.seed + 1900000 });
    return {
      format: SOLVER_FORMAT,
      algorithm: SOLVER_ALGORITHM,
      exactNash: false,
      approximation: 'Bucketed strategic information sets with Monte Carlo continuation regret matching. Hidden opponent hand identities and deck orders are excluded. Exact card artwork identity, zone order, exact turn, and exact deck counts are abstracted for tractability.',
      config: { seed: this.seed, exploration: this.exploration, rolloutsPerAction: this.rolloutsPerAction, maxActions: this.maxActions, fallback: this.fallback },
      training: { ...this.training, informationSets: this.nodes.size },
      evaluation: { madokaVsBaselineMami: madoka, mamiVsBaselineMadoka: mami },
      coverageGate: { threshold: 0.5, passed: madoka.coverage >= 0.5 && mami.coverage >= 0.5 },
      topInformationSets: this.topInformationSets(top),
    };
  }
}
