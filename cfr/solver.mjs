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

export const SOLVER_FORMAT = 'girls-cardgame-regret-policy-v2';
export const SOLVER_ALGORITHM = 'abstract-information-set-rollout-regret-matching';

export function seededRng(seed = 1) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function mechanicalCard(card, turn) {
  if (!card) return null;
  return {
    type: card.type ?? null,
    attack: card.attack ?? null,
    tributeThreshold: card.tributeThreshold ?? null,
    effect: card.effect ?? null,
    value: card.value ?? null,
    attacked: card.attackedTurn === turn,
  };
}

function canonicalCards(cards, turn, { keepNulls = false } = {}) {
  const encoded = cards
    .filter(card => keepNulls || card)
    .map(card => JSON.stringify(mechanicalCard(card, turn)))
    .sort();
  return encoded;
}

function sameNumbers(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function witchPlanForAction(adapter, playerIndex, handIndex, tributeMask) {
  const p = adapter.engine.player(playerIndex);
  const card = p.hand[handIndex];
  if (!card || card.type !== CARD_TYPES.WITCH) return null;
  const slots = tributeMaskToSlots(tributeMask).sort((a, b) => a - b);
  const plan = adapter.engine.validTributeSets(playerIndex, card)
    .find(candidate => sameNumbers([...candidate.slots].sort((a, b) => a - b), slots));
  if (!plan) return null;
  const field = slots
    .map(slot => p.field[slot])
    .filter(Boolean)
    .map(tribute => tribute.attack ?? 0)
    .sort((a, b) => a - b);
  const hand = plan.handIds
    .map(id => p.hand.find(candidate => candidate.id === id))
    .filter(Boolean)
    .map(tribute => tribute.attack ?? 0)
    .sort((a, b) => a - b);
  return { slots, field, hand, total: plan.total };
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
    const field = plan?.field?.join('+') ?? '';
    const hand = plan?.hand?.join('+') ?? '';
    return `summon:witch:${card.attack ?? 0}:F[${field}]:H[${hand}]`;
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
    const handIndex = action - ACTIONS.MAIN_MAGIC_BASE;
    const card = p.hand[handIndex];
    return `main-magic:${card?.effect ?? 'unknown'}:${card?.value ?? 0}`;
  }

  if (action >= ACTIONS.CHAIN_BASE && action < ACTIONS.REVIVE_BASE) {
    const handIndex = action - ACTIONS.CHAIN_BASE;
    const card = p.hand[handIndex];
    if (card?.effect === 'nullifyDamage') return 'chain:shield';
    if (card?.effect === 'boost') return `chain:boost:${card.value ?? 0}`;
    return `chain:${card?.effect ?? 'unknown'}`;
  }

  if (action >= ACTIONS.REVIVE_BASE && action < ACTIONS.COUNT) {
    const graveIndex = action - ACTIONS.REVIVE_BASE;
    const card = p.graveyard[graveIndex];
    return `revive:${card?.type ?? 'unknown'}:${card?.attack ?? 0}`;
  }
  return `action:${action}`;
}

function actionGroups(adapter, playerIndex, legalActions) {
  const groups = new Map();
  for (const action of legalActions) {
    const semantic = actionDescriptor(adapter, action, playerIndex);
    if (!groups.has(semantic)) groups.set(semantic, []);
    groups.get(semantic).push(action);
  }
  return groups;
}

function visibleState(adapter, playerIndex, legalActions) {
  const s = adapter.engine.state;
  const self = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  const battle = s.battle;
  const groups = actionGroups(adapter, playerIndex, legalActions);
  return {
    turn: s.turn,
    phase: s.phase,
    active: s.activePlayer === playerIndex,
    priority: s.priorityPlayer === playerIndex,
    pending: s.pendingDecision?.type ?? null,
    battlePhaseEnded: Boolean(s.battlePhaseEnded),
    chainPassCount: s.chainPassCount ?? 0,
    self: {
      character: self.character?.id ?? null,
      deckCount: self.deck.length,
      hand: canonicalCards(self.hand, s.turn),
      field: canonicalCards(self.field, s.turn),
      graveyard: canonicalCards(self.graveyard, s.turn),
      summonedThisTurn: Boolean(self.summonedThisTurn),
      specialUsed: Boolean(self.specialUsed),
    },
    opponent: {
      character: opp.character?.id ?? null,
      deckCount: opp.deck.length,
      handCount: opp.hand.length,
      field: canonicalCards(opp.field, s.turn),
      graveyard: canonicalCards(opp.graveyard, s.turn),
      summonedThisTurn: Boolean(opp.summonedThisTurn),
      specialUsed: Boolean(opp.specialUsed),
    },
    battle: battle ? {
      attackerIsSelf: battle.attackerPlayer === playerIndex,
      direct: Boolean(battle.direct),
      attackerBase: battle.attackerBase,
      defenderBase: battle.defenderBase,
      attackerBonus: battle.attackerBonus,
      defenderBonus: battle.defenderBonus,
      selfDamagePrevented: Boolean(battle.damagePrevented?.[playerIndex]),
      opponentDamagePrevented: Boolean(battle.damagePrevented?.[adapter.engine.opponent(playerIndex)]),
      endBattlePhase: Boolean(battle.endBattlePhase),
    } : null,
    chain: s.chain.map(item => ({
      self: item.player === playerIndex,
      card: mechanicalCard(item.card, s.turn),
    })),
    legalActions: [...groups.keys()].sort(),
  };
}

export function informationKey(adapter, playerIndex = adapter.currentPlayer(), legalActions = adapter.legalActions(playerIndex)) {
  return createHash('sha256')
    .update(JSON.stringify(visibleState(adapter, playerIndex, legalActions)))
    .digest('base64url');
}

export function visibleSummary(adapter, playerIndex = adapter.currentPlayer()) {
  const s = adapter.engine.state;
  const self = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  const short = card => card ? `${card.type}:${card.attack ?? card.effect ?? 0}${card.attackedTurn === s.turn ? '*' : ''}` : null;
  return {
    turn: s.turn,
    phase: s.phase,
    character: self.character?.id ?? null,
    active: s.activePlayer === playerIndex,
    ownDeck: self.deck.length,
    opponentDeck: opp.deck.length,
    ownHand: self.hand.map(short).sort(),
    ownField: self.field.filter(Boolean).map(short).sort(),
    opponentField: opp.field.filter(Boolean).map(short).sort(),
    ownGraveyard: self.graveyard.map(short).sort(),
    opponentGraveyard: opp.graveyard.map(short).sort(),
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
  const rng = seededRng(seed);
  return new RLAdapter(new GameEngine({
    players: ids.map((id, index) => ({ id: `p${index}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng,
  }));
}

function normalize(weights, actions) {
  let total = 0;
  for (const action of actions) total += Math.max(0, weights.get(action) ?? 0);
  if (total <= 0) {
    const probability = 1 / actions.length;
    return new Map(actions.map(action => [action, probability]));
  }
  return new Map(actions.map(action => [action, Math.max(0, weights.get(action) ?? 0) / total]));
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
  if (descriptor.startsWith('chain:shield')) return 'shield';
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

function concreteForSemantic(groups, semantic, rng) {
  const options = groups.get(semantic) ?? [];
  if (!options.length) throw new Error(`No concrete action for semantic action ${semantic}`);
  return options[Math.floor(rng() * options.length)];
}

function baselineSemantic(adapter, playerIndex, legalActions) {
  const chosen = chooseBaselineAction(adapter, playerIndex);
  if (!legalActions.includes(chosen)) return null;
  return actionDescriptor(adapter, chosen, playerIndex);
}

export class RegretSolver {
  constructor({
    seed = 1,
    exploration = 0.08,
    rolloutsPerAction = 1,
    maxActions = 260,
    fallback = 'baseline',
  } = {}) {
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
          return {
            key, node, groups, semantics,
            strategy: new Map(semantics.map(action => [action, (node.strategySum.get(action) ?? 0) / total])),
            fallback: false,
          };
        }
      }
      return { key, node, groups, semantics, strategy: normalize(node.regrets, semantics), fallback: false };
    }

    if (this.fallback === 'baseline') {
      const semantic = baselineSemantic(adapter, playerIndex, legalActions);
      if (semantic && groups.has(semantic)) {
        return {
          key, node: null, groups, semantics,
          strategy: new Map(semantics.map(action => [action, action === semantic ? 1 : 0])),
          fallback: true,
        };
      }
    }
    return { key, node: null, groups, semantics, strategy: normalize(new Map(), semantics), fallback: true };
  }

  choose(adapter, playerIndex, rng, { average = false, exploration = 0 } = {}) {
    const legalActions = adapter.legalActions(playerIndex);
    if (!legalActions.length) throw new Error(`No legal actions for player ${playerIndex}`);
    if (legalActions.length === 1) return { action: legalActions[0], semantic: actionDescriptor(adapter, legalActions[0], playerIndex), fallback: false };
    const bundle = this.strategyBundle(adapter, playerIndex, legalActions, { average });
    const semantic = sampleFrom(mixUniform(bundle.strategy, exploration), rng);
    return {
      action: concreteForSemantic(bundle.groups, semantic, rng),
      semantic,
      fallback: bundle.fallback,
    };
  }

  rollout(adapter, perspective, rng) {
    for (let actions = 0; actions < this.maxActions; actions++) {
      const terminal = terminalValue(adapter, perspective);
      if (terminal !== null) return terminal;
      const player = adapter.currentPlayer();
      const legal = adapter.legalActions(player);
      if (!legal.length) return cutoffValue(adapter, perspective);
      const chosen = legal.length === 1
        ? legal[0]
        : this.choose(adapter, player, rng, { average: false }).action;
      adapter.applyAction(chosen, player);
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
        const concrete = concreteForSemantic(groups, semantic, rng);
        child.applyAction(concrete, playerIndex);
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
        adapter.applyAction(concreteForSemantic(groups, semantic, rng), player);
      }

      const winner = adapter.engine.state.winner;
      if (winner === null || winner === undefined) this.training.draws += 1;
      else {
        const character = adapter.engine.player(winner).character?.id;
        if (character === 'madoka') this.training.madokaWins += 1;
        else if (character === 'mami') this.training.mamiWins += 1;
      }
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
      const useSolver = !baselineOpponent || character === solverCharacter;
      let action;
      let semantic;
      if (!useSolver) {
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

    return {
      winner: adapter.engine.state.winner,
      winnerCharacter: adapter.engine.state.winner === null || adapter.engine.state.winner === undefined
        ? null
        : adapter.engine.player(adapter.engine.state.winner).character?.id,
      terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
      turn: adapter.engine.state.turn,
      solverDecisions,
      fallbackDecisions,
      actionCounts,
    };
  }

  evaluateVsBaseline(character, { games = 100, seed = this.seed + 900000 } = {}) {
    const totals = {
      character,
      games,
      wins: 0,
      losses: 0,
      draws: 0,
      terminated: 0,
      solverDecisions: 0,
      fallbackDecisions: 0,
      actionCounts: {},
    };
    for (let game = 0; game < games; game++) {
      const swapped = character === 'madoka' ? game % 2 === 1 : game % 2 === 0;
      const result = this.playPolicyGame({
        seed: seed + game * 65537,
        swapped,
        solverCharacter: character,
        average: true,
        baselineOpponent: true,
      });
      if (result.terminated) totals.terminated += 1;
      if (result.winnerCharacter === character) totals.wins += 1;
      else if (result.winnerCharacter === null) totals.draws += 1;
      else totals.losses += 1;
      totals.solverDecisions += result.solverDecisions;
      totals.fallbackDecisions += result.fallbackDecisions;
      for (const [key, value] of Object.entries(result.actionCounts)) {
        totals.actionCounts[key] = (totals.actionCounts[key] ?? 0) + value;
      }
    }
    totals.winRate = totals.wins / games;
    totals.fallbackRate = totals.solverDecisions ? totals.fallbackDecisions / totals.solverDecisions : 0;
    return totals;
  }

  topInformationSets(limit = 30) {
    return [...this.nodes.values()]
      .sort((a, b) => b.visits - a.visits)
      .slice(0, limit)
      .map(node => {
        const total = [...node.strategySum.values()].reduce((sum, value) => sum + value, 0);
        const strategy = [...node.regrets.keys()].map(action => ({
          action,
          label: action,
          probability: total > 0 ? (node.strategySum.get(action) ?? 0) / total : 0,
          regret: node.regrets.get(action) ?? 0,
        })).sort((a, b) => b.probability - a.probability || b.regret - a.regret);
        return {
          key: node.key,
          character: node.character,
          visits: node.visits,
          summary: node.summary,
          strategy,
        };
      });
  }

  report({ evaluationGames = 100, top = 30 } = {}) {
    return {
      format: SOLVER_FORMAT,
      algorithm: SOLVER_ALGORITHM,
      exactNash: false,
      approximation: 'Mechanical card-equivalence information sets plus Monte Carlo continuation regret matching. Opponent hand identities and both deck orders are excluded; hand/field/grave order and duplicate card artwork identity are abstracted away.',
      config: {
        seed: this.seed,
        exploration: this.exploration,
        rolloutsPerAction: this.rolloutsPerAction,
        maxActions: this.maxActions,
        fallback: this.fallback,
      },
      training: { ...this.training, informationSets: this.nodes.size },
      evaluation: {
        madokaVsBaselineMami: this.evaluateVsBaseline('madoka', { games: evaluationGames }),
        mamiVsBaselineMadoka: this.evaluateVsBaseline('mami', { games: evaluationGames, seed: this.seed + 1900000 }),
      },
      topInformationSets: this.topInformationSets(top),
    };
  }
}
