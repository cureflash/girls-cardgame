const clone = value => value == null ? value : structuredClone(value);

export function cardForDuelLog(card) {
  if (!card) return null;
  return {
    id: card.id,
    code: card.code ?? null,
    name: card.name,
    type: card.type,
    attack: card.attack ?? null,
    rank: card.rank ?? null,
    tributeThreshold: card.tributeThreshold ?? null,
    effect: card.effect ?? null,
    value: card.value ?? null,
    chainable: Boolean(card.chainable),
    attackedTurn: card.attackedTurn ?? null,
  };
}

export function captureDuelState(engine) {
  const s = engine.state;
  return {
    turn: s.turn,
    phase: s.phase,
    activePlayer: s.activePlayer,
    priorityPlayer: s.priorityPlayer,
    pendingDecision: clone(s.pendingDecision),
    battle: clone(s.battle),
    battlePhaseEnded: Boolean(s.battlePhaseEnded),
    chain: s.chain.map(item => ({ player: item.player, card: cardForDuelLog(item.card) })),
    winner: s.winner,
    players: s.players.map(player => ({
      id: player.id,
      name: player.name,
      character: player.character?.id ?? null,
      deckCount: player.deck.length,
      hand: player.hand.map(cardForDuelLog),
      field: player.field.map(cardForDuelLog),
      graveyard: player.graveyard.map(cardForDuelLog),
      summonedThisTurn: Boolean(player.summonedThisTurn),
      specialUsed: Boolean(player.specialUsed),
    })),
  };
}

export function createDuelTrace({ engine, mode, humanSeat, rulesVersion, ai }) {
  return {
    format: 'girls-cardgame-duel-log',
    version: 1,
    rulesVersion,
    startedAt: new Date().toISOString(),
    endedAt: null,
    mode,
    humanSeat,
    ai,
    players: engine.state.players.map((player, index) => ({
      index,
      name: player.name,
      character: player.character?.id ?? null,
    })),
    initialState: captureDuelState(engine),
    steps: [],
  };
}

export function recordDuelStep(trace, { engine, actor, controller, action, legalActions, eventStart, before }) {
  const step = {
    index: trace.steps.length + 1,
    at: new Date().toISOString(),
    actor,
    controller,
    action: clone(action) ?? { type: 'unknown' },
    legalActionIds: [...legalActions],
    before: clone(before),
    events: clone(engine.state.events.slice(eventStart)),
    after: captureDuelState(engine),
  };
  trace.steps.push(step);
  if (engine.state.phase === 'GAME_OVER' && !trace.endedAt) trace.endedAt = step.at;
  return step;
}

export function buildDuelLog(trace, engine) {
  return {
    ...clone(trace),
    exportedAt: new Date().toISOString(),
    finalState: captureDuelState(engine),
    result: {
      finished: engine.state.phase === 'GAME_OVER',
      winner: engine.state.winner,
      winnerName: engine.state.winner == null ? null : engine.player(engine.state.winner).name,
      turn: engine.state.turn,
    },
    textLog: [...engine.state.logs],
    events: clone(engine.state.events),
  };
}
