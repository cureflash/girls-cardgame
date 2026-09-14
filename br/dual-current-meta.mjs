import fs from 'node:fs';
import { PHASES, CARD_TYPES } from '../src/game-engine.js';
import { chooseEvaluationAction, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { ACTIONS, RL_LIMITS } from '../src/rl-adapter.js';
import { actionDescriptor, cloneAdapter, createMatch, seededRng } from '../cfr/solver.mjs';
import { candidateActions, determinizeForPlayer } from './rollout-best-response.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadPair(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    madoka: normalizeEvaluationGenome(raw.madoka),
    mami: normalizeEvaluationGenome(raw.mami),
  };
}

function policyAction(adapter, player, pair) {
  const legal = adapter.legalActions(player);
  if (legal.length <= 1) return legal[0];
  const character = adapter.engine.player(player).character?.id;
  let action = chooseEvaluationAction(adapter, player, pair[character], () => 0);
  if (!legal.includes(action)) action = legal[0];
  return action;
}

function terminalScore(adapter, perspective) {
  if (adapter.engine.state.phase !== PHASES.GAME_OVER) return 0.5;
  const winner = adapter.engine.state.winner;
  if (winner === null || winner === undefined) return 0.5;
  return winner === perspective ? 1 : 0;
}

function rolloutPair(adapter, perspective, pair, maxActions) {
  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    adapter.applyAction(policyAction(adapter, player, pair), player);
  }
  return {
    score: terminalScore(adapter, perspective),
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
  };
}

function evaluateDecision(adapter, perspective, pair, { samples, seed, maxActions, minGain }) {
  const baselineAction = policyAction(adapter, perspective, pair);
  const candidates = candidateActions(adapter, perspective);
  if (!candidates.some(item => item.action === baselineAction)) {
    candidates.push({ action: baselineAction, label: `baseline:${actionDescriptor(adapter, baselineAction, perspective)}` });
  }
  if (candidates.length === 1) {
    return { action: baselineAction, label: candidates[0].label, deviated: false, gain: 0, cutoffs: 0 };
  }

  const rows = new Map(candidates.map(item => [item.action, { ...item, total: 0, cutoffs: 0 }]));
  for (let sample = 0; sample < samples; sample++) {
    const world = determinizeForPlayer(adapter, perspective, seededRng((seed + sample * 2654435761) >>> 0));
    for (const candidate of candidates) {
      const child = cloneAdapter(world);
      if (!child.legalActions(perspective).includes(candidate.action)) throw new Error('Candidate became illegal after determinization.');
      child.applyAction(candidate.action, perspective);
      const result = rolloutPair(child, perspective, pair, maxActions);
      const row = rows.get(candidate.action);
      row.total += result.score;
      row.cutoffs += Number(!result.terminated);
    }
  }

  const ranked = [...rows.values()].map(row => ({ ...row, score: row.total / samples }))
    .sort((a, b) => b.score - a.score || a.action - b.action);
  const baseline = ranked.find(row => row.action === baselineAction);
  if (!baseline) throw new Error('Baseline action missing from candidate set.');
  const rawBest = ranked[0];
  const selected = rawBest.action !== baselineAction && rawBest.score >= baseline.score + minGain ? rawBest : baseline;
  return {
    action: selected.action,
    label: selected.label,
    deviated: selected.action !== baselineAction,
    gain: selected.score - baseline.score,
    rawGain: rawBest.score - baseline.score,
    cutoffs: selected.cutoffs,
  };
}

function witchActionCard(adapter, player, action) {
  const p = adapter.engine.player(player);
  if (action >= ACTIONS.SUMMON_BASE && action < ACTIONS.ATTACK_BASE) {
    const offset = action - ACTIONS.SUMMON_BASE;
    const handIndex = Math.floor(offset / RL_LIMITS.TRIBUTE_MASKS);
    const card = p.hand[handIndex];
    if (card?.type === CARD_TYPES.WITCH) return { mode: 'summon', card };
  }
  if (action >= ACTIONS.REVIVE_BASE && action < ACTIONS.COUNT) {
    const card = p.graveyard[action - ACTIONS.REVIVE_BASE];
    if (card?.type === CARD_TYPES.WITCH) return { mode: 'revive', card };
  }
  return null;
}

function bumpUsage(bucket, info, seen) {
  if (!info) return;
  const key = info.card.name;
  const row = bucket[key] ??= { attack: info.card.attack ?? 0, summons: 0, revives: 0, appearances: 0, gamesSeen: 0 };
  if (info.mode === 'summon') row.summons += 1;
  else row.revives += 1;
  row.appearances += 1;
  seen.add(key);
}

function playDualPlanner({ pair, seed, samples, maxActions, minGain }) {
  const adapter = createMatch(seed, Boolean(seed & 1));
  const stats = {
    madoka: { decisions: 0, deviations: 0, cutoffs: 0, actions: {}, witchUsage: {} },
    mami: { decisions: 0, deviations: 0, cutoffs: 0, actions: {}, witchUsage: {} },
  };
  const seen = { madoka: new Set(), mami: new Set() };

  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    const character = adapter.engine.player(player).character?.id;
    let action;
    if (legal.length === 1) {
      action = legal[0];
    } else {
      const bucket = stats[character];
      const decision = evaluateDecision(adapter, player, pair, {
        samples,
        seed: (seed * 1000003 + step * 9176 + bucket.decisions * 37 + (character === 'mami' ? 7919 : 0)) >>> 0,
        maxActions,
        minGain,
      });
      action = decision.action;
      bucket.decisions += 1;
      bucket.cutoffs += decision.cutoffs;
      if (decision.deviated) {
        bucket.deviations += 1;
        bucket.actions[decision.label] = (bucket.actions[decision.label] ?? 0) + 1;
      }
    }
    bumpUsage(stats[character].witchUsage, witchActionCard(adapter, player, action), seen[character]);
    adapter.applyAction(action, player);
  }

  for (const character of ['madoka', 'mami']) {
    for (const name of seen[character]) stats[character].witchUsage[name].gamesSeen += 1;
  }

  const winner = adapter.engine.state.winner;
  return {
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
    winnerCharacter: winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id,
    madokaSeat: adapter.engine.state.players.findIndex(player => player.character?.id === 'madoka'),
    stats,
  };
}

const pairFile = arg('pair', 'ga/current-meta-analysis-pair.json');
const output = arg('output', '/tmp/dual-current-meta.json');
const games = Number(arg('games', 100));
const samples = Number(arg('samples', 16));
const seed = Number(arg('seed', 2026091601));
const maxActions = Number(arg('max-actions', 300));
const minGain = Number(arg('min-gain', 0.05));
const pair = loadPair(pairFile);

const report = {
  format: 'girls-cardgame-dual-rollout-current-meta-v2',
  pairFile, games, samples, seed, maxActions, minGain,
  madoka: { wins: 0, losses: 0, draws: 0, bySeat: { first: { games: 0, wins: 0 }, second: { games: 0, wins: 0 } }, decisions: 0, deviations: 0, cutoffs: 0, actions: {}, witchUsage: {} },
  mami: { wins: 0, losses: 0, draws: 0, decisions: 0, deviations: 0, cutoffs: 0, actions: {}, witchUsage: {} },
  terminated: 0,
};

for (let game = 0; game < games; game++) {
  const result = playDualPlanner({ pair, seed: seed + game * 65537, samples, maxActions, minGain });
  report.terminated += Number(result.terminated);
  if (result.winnerCharacter === 'madoka') {
    report.madoka.wins += 1;
    report.mami.losses += 1;
  } else if (result.winnerCharacter === 'mami') {
    report.mami.wins += 1;
    report.madoka.losses += 1;
  } else {
    report.madoka.draws += 1;
    report.mami.draws += 1;
  }
  const seat = result.madokaSeat === 0 ? 'first' : 'second';
  report.madoka.bySeat[seat].games += 1;
  report.madoka.bySeat[seat].wins += Number(result.winnerCharacter === 'madoka');

  for (const character of ['madoka', 'mami']) {
    const source = result.stats[character];
    const target = report[character];
    target.decisions += source.decisions;
    target.deviations += source.deviations;
    target.cutoffs += source.cutoffs;
    for (const [label, count] of Object.entries(source.actions)) target.actions[label] = (target.actions[label] ?? 0) + count;
    for (const [name, row] of Object.entries(source.witchUsage)) {
      const aggregate = target.witchUsage[name] ??= { attack: row.attack, summons: 0, revives: 0, appearances: 0, gamesSeen: 0 };
      aggregate.summons += row.summons;
      aggregate.revives += row.revives;
      aggregate.appearances += row.appearances;
      aggregate.gamesSeen += row.gamesSeen;
    }
  }
}

for (const character of ['madoka', 'mami']) {
  const bucket = report[character];
  bucket.winRate = bucket.wins / games;
  bucket.deviationRate = bucket.decisions ? bucket.deviations / bucket.decisions : 0;
  bucket.topDeviations = Object.entries(bucket.actions).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([label, count]) => ({ label, count }));
}
for (const seat of ['first', 'second']) {
  const bucket = report.madoka.bySeat[seat];
  bucket.winRate = bucket.games ? bucket.wins / bucket.games : 0;
}

fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  games, samples,
  madoka: `${report.madoka.wins}-${report.madoka.losses}-${report.madoka.draws}`,
  mami: `${report.mami.wins}-${report.mami.losses}-${report.mami.draws}`,
  madokaWinRate: report.madoka.winRate,
  mamiWinRate: report.mami.winRate,
  madokaBySeat: report.madoka.bySeat,
  madokaDeviationRate: report.madoka.deviationRate,
  mamiDeviationRate: report.mami.deviationRate,
  cutoffs: { madoka: report.madoka.cutoffs, mami: report.mami.cutoffs },
  witchUsage: { madoka: report.madoka.witchUsage, mami: report.mami.witchUsage },
  topMadokaDeviations: report.madoka.topDeviations.slice(0, 12),
  topMamiDeviations: report.mami.topDeviations.slice(0, 12),
  output,
}, null, 2));
