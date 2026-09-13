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

export const SOLVER_FORMAT = 'girls-cardgame-regret-policy-v1';
export const SOLVER_ALGORITHM = 'information-set-rollout-regret-matching';

export function seededRng(seed = 1) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function publicCard(card, turn) {
  if (!card) return null;
  return {
    code: card.code ?? null,
    type: card.type ?? null,
    attack: card.attack ?? null,
    tributeThreshold: card.tributeThreshold ?? null,
    effect: card.effect ?? null,
    value: card.value ?? null,
    attacked: card.attackedTurn === turn,
  };
}

function visibleState(adapter, playerIndex, legalActions) {
  const s = adapter.engine.state;
  const self = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  const battle = s.battle;
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
      hand: self.hand.map(card => publicCard(card, s.turn)),
      field: self.field.map(card => publicCard(card, s.turn)),
      graveyard: self.graveyard.map(card => publicCard(card, s.turn)),
      summonedThisTurn: Boolean(self.summonedThisTurn),
      specialUsed: Boolean(self.specialUsed),
    },
    opponent: {
      character: opp.character?.id ?? null,
      deckCount: opp.deck.length,
      handCount: opp.hand.length,
      field: opp.field.map(card => publicCard(card, s.turn)),
      graveyard: opp.graveyard.map(card => publicCard(card, s.turn)),
      summonedThisTurn: Boolean(opp.summonedThisTurn),
      specialUsed: Boolean(opp.specialUsed),
    },
    battle: battle ? {
      attackerIsSelf: battle.attackerPlayer === playerIndex,
      attackerSlot: battle.attackerSlot,
      defenderSlot: battle.defenderSlot,
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
      card: publicCard(item.card, s.turn),
    })),
    legalActions: [...legalActions].sort((a, b) => a - b),
  };
}

export function informationKey(adapter, playerIndex = adapter.currentPlayer(), legalActions = adapter.legalActions(playerIndex)) {
  const visible = visibleState(adapter, playerIndex, legalActions);
  return createHash('sha256').update(JSON.stringify(visible)).digest('base64url');
}

export function visibleSummary(adapter, playerIndex = adapter.currentPlayer()) {
  const s = adapter.engine.state;
  const self = adapter.engine.player(playerIndex);
  const opp = adapter.engine.player(adapter.engine.opponent(playerIndex));
  const short = card => card ? `${card.code ?? card.name}${card.attackedTurn === s.turn ? '*' : ''}` : null;
  return {
    turn: s.turn,
    phase: s.phase,
    character: self.character?.id ?? null,
    active: s.activePlayer === playerIndex,
    ownDeck: self.deck.length,
    opponentDeck: opp.deck.length,
    ownHand: self.hand.map(short),
    ownField: self.field.map(short),
    opponentField: opp.field.map(short),
    ownGraveyard: self.graveyard.map(short),
    opponentGraveyard: opp.graveyard.map(short),
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
  const engine = new GameEngine({
    players: ids.map((id, index) => ({ id: `p${index}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng,
  });
  return new RLAdapter(engine);
}

function normalize(weights, actions) {
  let total = 0;
  for (const action of actions) total += Math.max(0, weights.get(action) ?? 0);
  if (total <= 0) {
    const p = 1 / actions.length;
    return new Map(actions.map(action => [action, p]));
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
  return new Map([...strategy].map(([action, p]) => [action, (1 - epsilon) * p + epsilon / n]));
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
    if (!card) return `summon:missing:${handIndex}`;
    if (card.type === CARD_TYPES.FAMILIAR) return `summon:familiar:${card.attack}`;
    return `summon:witch:${card.attack}:field[${tributeMaskToSlots(tributeMask).join(',')}]`;
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

function baselineStrategy(adapter, playerIndex, legalActions) {
  const chosen = chooseBaselineAction(adapter, playerIndex);
  if (!legalActions.includes(chosen)) return null;
  return new Map(legalActions.map(action => [action, action === chosen ? 1 : 0]));
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
    const key = informationKey(adapter, playerIndex, legalActions);
    let node = this.nodes.get(key);
    if (!node) {
      node = {
        key,
        character: adapter.engine.player(playerIndex).character?.id ?? null,
        visits: 0,
        regrets: new Map(legalActions.map(action => [action, 0])),
        strategySum: new Map(legalActions.map(action => [action, 0])),
        labels: new Map(legalActions.map(action => [action, actionDescriptor(adapter, action, playerIndex)])),
        summary: visibleSummary(adapter, playerIndex),
      };
      this.nodes.set(key, node);
    }
    return node;
  }

  currentStrategy(adapter, playerIndex, legalActions) {
    const key = informationKey(adapter, playerIndex, legalActions);
    const node = this.nodes.get(key);
    if (node) return normalize(node.regrets, legalActions);
    if (this.fallback === 'baseline') {
      const prior = baselineStrategy(adapter, playerIndex, legalActions);
      if (prior) return prior;
    }
    return normalize(new Map(), legalActions);
  }

  averageStrategy(adapter, playerIndex, legalActions) {
    const key = informationKey(adapter, playerIndex, legalActions);
    const node = this.nodes.get(key);
    if (node) {
      const total = [...node.strategySum.values()].reduce((sum, value) => sum + value, 0);
      if (total > 0) return new Map(legalActions.map(action => [action, (node.strategySum.get(action) ?? 0) / total]));
      return normalize(node.regrets, legalActions);
    }
    if (this.fallback === 'baseline') {
      const prior = baselineStrategy(adapter, playerIndex, legalActions);
      if (prior) return prior;
    }
    return normalize(new Map(), legalActions);
  }

  choose(adapter, playerIndex, rng, { average = false, exploration = 0 } = {}) {
    const legal = adapter.legalActions(playerIndex);
    if (!legal.length) throw new Error(`No legal actions for player ${playerIndex}`);
    if (legal.length === 1) return legal[0];
    const strategy = average
      ? this.averageStrategy(adapter, playerIndex, legal)
      : this.currentStrategy(adapter, playerIndex, legal);
    return sampleFrom(mixUniform(strategy, exploration), rng);
  }

  rollout(adapter, perspective, rng) {
    for (let actions = 0; actions < this.maxActions; actions++) {
      const terminal = terminalValue(adapter, perspective);
      if (terminal !== null) return terminal;
      const player = adapter.currentPlayer();
      const legal = adapter.legalActions(player);
      if (!legal.length) return cutoffValue(adapter, perspective);
      const action = legal.length === 1 ? legal[0] : this.choose(adapter, player, rng, { average: false });
      adapter.applyAction(action, player);
    }
    this.training.cutoffs += 1;
    return cutoffValue(adapter, perspective);
  }

  evaluateActions(adapter, playerIndex, legalActions, rng) {
    const values = new Map();
    for (const action of legalActions) {
      let total = 0;
      for (let rollout = 0; rollout < this.rolloutsPerAction; rollout++) {
        const child = cloneAdapter(adapter);
        child.applyAction(action, playerIndex);
        total += this.rollout(child, playerIndex, rng);
      }
      values.set(action, total / this.rolloutsPerAction);
    }
    return values;
  }

  train({ iterations = 100, seed = this.seed } = {}) {
    const rng = seededRng(seed ^ 0xa5a5a5a5);
    for (let iteration = 0; iteration < iterations; iteration++) {
      const swapped = iteration % 2 === 1;
      const adapter = createMatch(seed + iteration * 104729, swapped);
      for (let actions = 0; actions < this.maxActions; actions++) {
        if (adapter.engine.state.phase === PHASES.GAME_OVER) break;
        const player = adapter.currentPlayer();
        const legal = adapter.legalActions(player);
        if (!legal.length) break;
        if (legal.length === 1) {
          adapter.applyAction(legal[0], player);
          continue;
        }

        const node = this.ensureNode(adapter, player, legal);
        const strategy = normalize(node.regrets, legal);
        const values = this.evaluateActions(adapter, player, legal, rng);
        const baseline = legal.reduce((sum, action) => sum + (strategy.get(action) ?? 0) * values.get(action), 0);
        for (const action of legal) {
          node.regrets.set(action, (node.regrets.get(action) ?? 0) + values.get(action) - baseline);
          node.strategySum.set(action, (node.strategySum.get(action) ?? 0) + (strategy.get(action) ?? 0));
        }
        node.visits += 1;
        this.training.decisions += 1;

        const sampling = mixUniform(strategy, this.exploration);
        const chosen = sampleFrom(sampling, rng);
        adapter.applyAction(chosen, player);
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
      let action;
      const useSolver = !baselineOpponent || character === solverCharacter;
      if (!useSolver) {
        action = chooseBaselineAction(adapter, player);
      } else if (legal.length === 1) {
        action = legal[0];
      } else {
        const key = informationKey(adapter, player, legal);
        if (!this.nodes.has(key)) fallbackDecisions += 1;
        action = this.choose(adapter, player, rng, { average });
        solverDecisions += 1;
        const descriptor = actionDescriptor(adapter, action, player);
        const cls = actionClass(descriptor);
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
        const strategy = [...node.labels.entries()].map(([action, label]) => ({
          action,
          label,
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
      approximation: 'Visible-information-set regret matching with Monte Carlo continuation rollouts. Opponent hand identities and both deck orders are excluded from information keys.',
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
