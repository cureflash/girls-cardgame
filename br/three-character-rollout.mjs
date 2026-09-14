import fs from 'node:fs';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { GameEngine, PHASES } from '../src/three-character-engine.js';
import { ThreeCharacterAdapter } from '../src/three-character-adapter.js';
import { ACTIONS } from '../src/rl-adapter.js';
import { DEFAULT_GENOME, chooseEvaluationAction } from '../src/evaluation-ai.js';
import { candidateActions } from './rollout-best-response.mjs';
import { mulberry32 } from '../ga/genetics.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function cloneAdapter(adapter) {
  const ids = adapter.engine.state.players.map(player => player.character.id);
  const engine = new GameEngine({
    players: ids.map((id, index) => ({ id: `p${index}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng: () => 0.5,
  });
  engine.state = structuredClone(adapter.engine.state);
  engine.rng = adapter.engine.rng;
  const clone = new ThreeCharacterAdapter(engine);
  clone.eventCursor = adapter.eventCursor;
  clone.stats = structuredClone(adapter.stats);
  return clone;
}

function shuffle(cards, rng) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function removeKnown(template, knownCards) {
  const remaining = [...template];
  for (const known of knownCards.filter(Boolean)) {
    let index = remaining.findIndex(card => card.id === known.id);
    if (index < 0) index = remaining.findIndex(card => card.code === known.code);
    if (index < 0) throw new Error(`Cannot reconcile known card ${known.id ?? known.code}.`);
    remaining.splice(index, 1);
  }
  return remaining;
}

function chainCardsFor(adapter, playerIndex) {
  return adapter.engine.state.chain.filter(item => item.player === playerIndex).map(item => item.card).filter(Boolean);
}

function pendingSelectedFor(adapter, playerIndex) {
  const d = adapter.engine.state.pendingDecision;
  return d?.type === 'SAYAKA_RECYCLE' && d.player === playerIndex ? (d.selectedCards ?? []) : [];
}

function determinizeForPlayer(adapter, perspective, rng) {
  const sampled = cloneAdapter(adapter);
  const self = sampled.engine.player(perspective);
  const opponentIndex = sampled.engine.opponent(perspective);
  const opp = sampled.engine.player(opponentIndex);

  const selfKnown = [
    ...self.hand,
    ...self.field.filter(Boolean),
    ...self.graveyard,
    ...chainCardsFor(sampled, perspective),
    ...pendingSelectedFor(sampled, perspective),
  ];
  const selfUnseen = removeKnown(createDeck(self.character.id), selfKnown);
  if (selfUnseen.length !== self.deck.length) throw new Error(`Self unseen mismatch ${self.character.id}: ${selfUnseen.length} vs ${self.deck.length}`);
  self.deck = shuffle(selfUnseen, rng).map(card => ({ ...card }));

  const oppPublic = [
    ...opp.field.filter(Boolean),
    ...opp.graveyard,
    ...chainCardsFor(sampled, opponentIndex),
    ...pendingSelectedFor(sampled, opponentIndex),
  ];
  const oppUnseen = shuffle(removeKnown(createDeck(opp.character.id), oppPublic), rng);
  const hiddenCount = opp.hand.length + opp.deck.length;
  if (oppUnseen.length !== hiddenCount) throw new Error(`Opponent unseen mismatch ${opp.character.id}: ${oppUnseen.length} vs ${hiddenCount}`);
  opp.hand = oppUnseen.slice(0, opp.hand.length).map(card => ({ ...card }));
  opp.deck = oppUnseen.slice(opp.hand.length).map(card => ({ ...card }));
  return sampled;
}

function recycleValue(card) {
  if (!card) return -Infinity;
  if (card.type === 'witch') return 100 + (card.attack ?? 0);
  if (card.effect === 'nullifyDamage') return 95;
  if (card.effect === 'boost') return 80 + (card.value ?? 0);
  if (card.type === 'familiar') return 60 + (card.attack ?? 0);
  return 0;
}

function baselineAction(adapter, player, rng) {
  const legal = adapter.legalActions(player);
  if (legal.length <= 1) return legal[0];
  if (adapter.engine.state.pendingDecision?.type === 'SAYAKA_RECYCLE') {
    const grave = adapter.engine.player(player).graveyard;
    return [...legal].sort((a, b) => recycleValue(grave[b - ACTIONS.REVIVE_BASE]) - recycleValue(grave[a - ACTIONS.REVIVE_BASE]) || a - b)[0];
  }
  let action = chooseEvaluationAction(adapter, player, DEFAULT_GENOME, rng);
  if (!legal.includes(action)) action = legal[0];
  return action;
}

function terminalScore(adapter, perspective) {
  if (adapter.engine.state.phase !== PHASES.GAME_OVER) return 0.5;
  const winner = adapter.engine.state.winner;
  return winner === null || winner === undefined ? 0.5 : winner === perspective ? 1 : 0;
}

function rollout(adapter, perspective, maxActions, rng) {
  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    adapter.applyAction(baselineAction(adapter, player, rng), player);
  }
  return { score: terminalScore(adapter, perspective), terminated: adapter.engine.state.phase === PHASES.GAME_OVER };
}

function decisionCandidates(adapter, player) {
  const legal = adapter.legalActions(player);
  if (adapter.engine.state.pendingDecision?.type === 'SAYAKA_RECYCLE') {
    return legal.map(action => ({ action, label: `recycle:${adapter.engine.player(player).graveyard[action - ACTIONS.REVIVE_BASE]?.code ?? action}` }));
  }
  return candidateActions(adapter, player);
}

function evaluateDecision(adapter, perspective, { samples, seed, maxActions, minGain }) {
  const candidates = decisionCandidates(adapter, perspective);
  const baseline = baselineAction(adapter, perspective, mulberry32(seed ^ 0x9e3779b9));
  if (!candidates.some(item => item.action === baseline)) candidates.push({ action: baseline, label: 'baseline' });
  if (candidates.length === 1) return { action: candidates[0].action, deviated: false, cutoffs: 0 };

  const rows = new Map(candidates.map(item => [item.action, { ...item, total: 0, cutoffs: 0 }]));
  for (let sample = 0; sample < samples; sample++) {
    const world = determinizeForPlayer(adapter, perspective, mulberry32((seed + sample * 2654435761) >>> 0));
    for (const candidate of candidates) {
      const child = cloneAdapter(world);
      if (!child.legalActions(perspective).includes(candidate.action)) throw new Error('Candidate became illegal after determinization.');
      child.applyAction(candidate.action, perspective);
      const result = rollout(child, perspective, maxActions, mulberry32((seed ^ candidate.action ^ (sample * 7919)) >>> 0));
      const row = rows.get(candidate.action);
      row.total += result.score;
      row.cutoffs += Number(!result.terminated);
    }
  }
  const ranked = [...rows.values()].map(row => ({ ...row, score: row.total / samples })).sort((a, b) => b.score - a.score || a.action - b.action);
  const baselineRow = ranked.find(row => row.action === baseline);
  const best = ranked[0];
  const selected = best.action !== baseline && best.score >= baselineRow.score + minGain ? best : baselineRow;
  return { action: selected.action, deviated: selected.action !== baseline, cutoffs: selected.cutoffs };
}

function playGame(a, b, { seed, aFirst, samples, maxActions, minGain }) {
  const ids = aFirst ? [a, b] : [b, a];
  const rng = mulberry32(seed);
  const engine = new GameEngine({
    players: ids.map((id, index) => ({ id: `p${index}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng,
  });
  const adapter = new ThreeCharacterAdapter(engine);
  const stats = Object.fromEntries(ids.map(id => [id, { decisions: 0, deviations: 0, cutoffs: 0, specials: 0 }]));

  for (let step = 0; step < maxActions && engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const character = engine.player(player).character.id;
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    let action;
    if (legal.length === 1) action = legal[0];
    else {
      const bucket = stats[character];
      const decision = evaluateDecision(adapter, player, {
        samples,
        seed: (seed * 1000003 + step * 9176 + bucket.decisions * 37 + player * 7919) >>> 0,
        maxActions,
        minGain,
      });
      action = decision.action;
      bucket.decisions += 1;
      bucket.deviations += Number(decision.deviated);
      bucket.cutoffs += decision.cutoffs;
    }
    if (action === ACTIONS.SPECIAL) stats[character].specials += 1;
    adapter.applyAction(action, player);
  }

  const winner = engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null;
  return {
    winner: winner === null ? null : engine.player(winner).character.id,
    first: ids[0],
    second: ids[1],
    truncated: winner === null,
    stats,
  };
}

function playPair(a, b, opts) {
  const result = {
    a, b, games: opts.games,
    wins: { [a]: 0, [b]: 0 }, draws: 0, truncated: 0,
    bySeat: {
      [a]: { first: { games: 0, wins: 0 }, second: { games: 0, wins: 0 } },
      [b]: { first: { games: 0, wins: 0 }, second: { games: 0, wins: 0 } },
    },
    stats: { [a]: { decisions: 0, deviations: 0, cutoffs: 0, specials: 0 }, [b]: { decisions: 0, deviations: 0, cutoffs: 0, specials: 0 } },
  };
  for (let game = 0; game < opts.games; game++) {
    const detail = playGame(a, b, { ...opts, seed: opts.seed + game * 65537, aFirst: game % 2 === 0 });
    result.truncated += Number(detail.truncated);
    if (detail.winner) result.wins[detail.winner] += 1; else result.draws += 1;
    for (const id of [a, b]) {
      const seat = detail.first === id ? 'first' : 'second';
      result.bySeat[id][seat].games += 1;
      result.bySeat[id][seat].wins += Number(detail.winner === id);
      for (const key of ['decisions', 'deviations', 'cutoffs', 'specials']) result.stats[id][key] += detail.stats[id][key];
    }
  }
  result.winRates = { [a]: result.wins[a] / opts.games, [b]: result.wins[b] / opts.games };
  return result;
}

const output = arg('output', '/tmp/three-character-rollout.json');
const games = Number(arg('games', 100));
const samples = Number(arg('samples', 8));
const seed = Number(arg('seed', 2026091404));
const maxActions = Number(arg('max-actions', 300));
const minGain = Number(arg('min-gain', 0.05));
const pairs = [['madoka', 'mami'], ['madoka', 'sayaka'], ['mami', 'sayaka']];
const pairResults = pairs.map(([a, b], index) => playPair(a, b, { games, samples, seed: seed + index * 20_000_033, maxActions, minGain }));
const aggregate = Object.fromEntries(['madoka', 'mami', 'sayaka'].map(id => [id, { games: 0, wins: 0, losses: 0, draws: 0 }]));
for (const pair of pairResults) {
  for (const id of [pair.a, pair.b]) {
    const other = id === pair.a ? pair.b : pair.a;
    aggregate[id].games += pair.games;
    aggregate[id].wins += pair.wins[id];
    aggregate[id].losses += pair.wins[other];
    aggregate[id].draws += pair.draws;
  }
}
for (const row of Object.values(aggregate)) row.winRate = row.wins / row.games;

const report = {
  format: 'girls-cardgame-three-character-mutual-rollout-v1',
  policy: 'shared-default-evaluation plus equal hidden-information conservative rollout for all characters',
  gamesPerPair: games, samples, seed, maxActions, minGain,
  deckCondition: 'Sayaka mirrors Madoka 30-card numerical pool; character abilities differ.',
  sayakaRule: { passive: 'witch tribute threshold -1', special: 'return any 3 graveyard cards to bottom of deck, then end turn' },
  pairResults, aggregate,
};
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  pairs: pairResults.map(pair => ({ matchup: `${pair.a}-vs-${pair.b}`, wins: pair.wins, draws: pair.draws, truncated: pair.truncated, winRates: pair.winRates, stats: pair.stats })),
  aggregate,
  output,
}, null, 2));
