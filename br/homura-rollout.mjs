import fs from 'node:fs';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { GameEngine, PHASES } from '../src/three-character-engine.js';
import { ThreeCharacterAdapter } from '../src/three-character-adapter.js';
import { ACTIONS, RL_LIMITS, tributeMaskToSlots } from '../src/rl-adapter.js';
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
  engine.rng = () => 0.5;
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
  const handCount = opp.hand.length;
  opp.hand = oppUnseen.slice(0, handCount).map(card => ({ ...card }));
  opp.deck = oppUnseen.slice(handCount).map(card => ({ ...card }));
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

function kyokoTargetValue(adapter, player, action) {
  const slot = action - ACTIONS.REVIVE_BASE;
  const opponent = adapter.engine.player(adapter.engine.opponent(player));
  return opponent.field[slot]?.attack ?? -Infinity;
}

function kyokoSummonInfo(adapter, player, action) {
  if (action < ACTIONS.SUMMON_BASE || action >= ACTIONS.ATTACK_BASE) return null;
  const decision = adapter.engine.state.pendingDecision;
  if (decision?.type !== 'KYOKO_WITCH_SUMMON') return null;
  const offset = action - ACTIONS.SUMMON_BASE;
  const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
  const mask = offset % RL_LIMITS.TRIBUTE_MASKS;
  const witch = adapter.engine.player(player).hand[handIndex];
  if (!witch) return null;
  const slots = tributeMaskToSlots(mask);
  const plan = adapter.engine.validKyokoTributeSets(player, witch, decision.opponentSlot)
    .find(candidate => candidate.slots.length === slots.length && candidate.slots.every((slot, i) => slot === slots[i]));
  if (!plan) return null;
  return {
    action,
    attack: witch.attack ?? 0,
    ownTotal: plan.ownTotal ?? 0,
    ownCount: plan.slots.length + plan.handIds.length,
    label: `kyoko-summon:${witch.attack ?? 0}:own-${plan.ownTotal ?? 0}`,
  };
}

function baselineAction(adapter, player, rng) {
  const legal = adapter.legalActions(player);
  if (legal.length <= 1) return legal[0];
  const pending = adapter.engine.state.pendingDecision?.type;
  if (pending === 'SAYAKA_RECYCLE') {
    const grave = adapter.engine.player(player).graveyard;
    return [...legal].sort((a, b) => recycleValue(grave[b - ACTIONS.REVIVE_BASE]) - recycleValue(grave[a - ACTIONS.REVIVE_BASE]) || a - b)[0];
  }
  if (pending === 'KYOKO_OPPONENT_TRIBUTE') {
    return [...legal].sort((a, b) => kyokoTargetValue(adapter, player, b) - kyokoTargetValue(adapter, player, a) || a - b)[0];
  }
  if (pending === 'KYOKO_WITCH_SUMMON') {
    return [...legal].map(action => kyokoSummonInfo(adapter, player, action)).filter(Boolean)
      .sort((a, b) => b.attack - a.attack || a.ownTotal - b.ownTotal || a.ownCount - b.ownCount || a.action - b.action)[0].action;
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
  const pending = adapter.engine.state.pendingDecision?.type;
  if (pending === 'SAYAKA_RECYCLE') {
    return legal.map(action => ({ action, label: `recycle:${adapter.engine.player(player).graveyard[action - ACTIONS.REVIVE_BASE]?.code ?? action}` }));
  }
  if (pending === 'KYOKO_OPPONENT_TRIBUTE') {
    const opponent = adapter.engine.player(adapter.engine.opponent(player));
    return legal.map(action => {
      const slot = action - ACTIONS.REVIVE_BASE;
      const card = opponent.field[slot];
      return { action, label: `kyoko-target:${card?.attack ?? 0}:${card?.code ?? slot}` };
    });
  }
  if (pending === 'KYOKO_WITCH_SUMMON') {
    const infos = legal.map(action => kyokoSummonInfo(adapter, player, action)).filter(Boolean);
    const bestByAttack = new Map();
    for (const info of infos) {
      const current = bestByAttack.get(info.attack);
      if (!current || info.ownTotal < current.ownTotal
        || (info.ownTotal === current.ownTotal && info.ownCount < current.ownCount)
        || (info.ownTotal === current.ownTotal && info.ownCount === current.ownCount && info.action < current.action)) {
        bestByAttack.set(info.attack, info);
      }
    }
    return [...bestByAttack.values()].map(info => ({ action: info.action, label: info.label }));
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
    const sampleSeed = (seed + sample * 2654435761) >>> 0;
    const world = determinizeForPlayer(adapter, perspective, mulberry32(sampleSeed));
    for (const candidate of candidates) {
      const child = cloneAdapter(world);
      child.engine.rng = mulberry32((sampleSeed ^ 0xa5a5a5a5) >>> 0);
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

const output = arg('output', '/tmp/homura-rollout.json');
const games = Number(arg('games', 100));
const samples = Number(arg('samples', 4));
const seed = Number(arg('seed', 2026091421));
const maxActions = Number(arg('max-actions', 300));
const minGain = Number(arg('min-gain', 0.05));
const pairs = [
  ['madoka', 'homura'],
  ['mami', 'homura'],
  ['sayaka', 'homura'],
  ['kyoko', 'homura'],
];
const pairResults = pairs.map(([a, b], index) => playPair(a, b, { games, samples, seed: seed + index * 20_000_033, maxActions, minGain }));
const aggregate = Object.fromEntries(['madoka', 'mami', 'sayaka', 'kyoko', 'homura'].map(id => [id, { games: 0, wins: 0, losses: 0, draws: 0 }]));
for (const pair of pairResults) {
  for (const id of [pair.a, pair.b]) {
    const other = id === pair.a ? pair.b : pair.a;
    aggregate[id].games += pair.games;
    aggregate[id].wins += pair.wins[id];
    aggregate[id].losses += pair.wins[other];
    aggregate[id].draws += pair.draws;
  }
}
for (const row of Object.values(aggregate)) row.winRate = row.games ? row.wins / row.games : null;

const report = {
  format: 'girls-cardgame-homura-focused-mutual-rollout-v2-no-passive',
  policy: 'shared-default-evaluation plus equal hidden-information conservative rollout for all characters',
  gamesPerPair: games, samples, seed, maxActions, minGain,
  deckCondition: 'All five characters use mechanically identical 30-card decks; only character abilities and names/art skins differ.',
  sayakaRule: { passive: 'effective witch tribute threshold -3 as a character ability', special: 'return any 3 graveyard cards to deck, shuffle the whole deck, then end turn' },
  kyokoRule: { passive: 'none', special: 'at battle-start once per duel, use exactly one opposing familiar/witch as tribute toward summoning one witch from hand; pay any remaining cost with normal own tributes; the special summon is additional to the normal summon and ends the turn' },
  homuraRule: { passive: 'none', special: 'once per duel at battle-start, opponent cannot chain for the rest of that turn; Homura does not skip battle and can chain her own boost magic' },
  pairResults, aggregate,
};
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  pairs: pairResults.map(pair => ({ matchup: `${pair.a}-vs-${pair.b}`, wins: pair.wins, draws: pair.draws, truncated: pair.truncated, winRates: pair.winRates, stats: pair.stats })),
  homura: aggregate.homura,
  output,
}, null, 2));
