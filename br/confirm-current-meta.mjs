import fs from 'node:fs';
import { PHASES } from '../src/game-engine.js';
import { chooseEvaluationAction, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
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
  let steps = 0;
  for (; steps < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; steps++) {
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

function playBaseline({ pair, character, seed, maxActions }) {
  const swapped = character === 'madoka' ? Boolean(seed & 1) : !Boolean(seed & 1);
  const adapter = createMatch(seed, swapped);
  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    adapter.applyAction(policyAction(adapter, player, pair), player);
  }
  const winner = adapter.engine.state.winner;
  return {
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
    winnerCharacter: winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id,
  };
}

function playPlanner({ pair, character, seed, samples, maxActions, minGain }) {
  const swapped = character === 'madoka' ? Boolean(seed & 1) : !Boolean(seed & 1);
  const adapter = createMatch(seed, swapped);
  const perspective = adapter.engine.state.players.findIndex(player => player.character?.id === character);
  const deviations = {};
  let plannerDecisions = 0;
  let deviationCount = 0;
  let cutoffs = 0;

  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    let action;
    if (player !== perspective || legal.length === 1) {
      action = policyAction(adapter, player, pair);
    } else {
      const decision = evaluateDecision(adapter, perspective, pair, {
        samples,
        seed: (seed * 1000003 + step * 9176 + plannerDecisions * 37) >>> 0,
        maxActions,
        minGain,
      });
      action = decision.action;
      plannerDecisions += 1;
      cutoffs += decision.cutoffs;
      if (decision.deviated) {
        deviationCount += 1;
        deviations[decision.label] = (deviations[decision.label] ?? 0) + 1;
      }
    }
    adapter.applyAction(action, player);
  }
  const winner = adapter.engine.state.winner;
  return {
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
    winnerCharacter: winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id,
    plannerDecisions,
    deviationCount,
    cutoffs,
    deviations,
  };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let value = 1;
  for (let i = 1; i <= k; i++) value = value * (n - k + i) / i;
  return value;
}

function signP(a, b) {
  const n = a + b;
  if (!n) return 1;
  const k = Math.min(a, b);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += choose(n, i) * Math.pow(0.5, n);
  return Math.min(1, 2 * tail);
}

const pairFile = arg('pair', 'ga/current-meta-analysis-pair.json');
const output = arg('output', '/tmp/current-meta-best-response.json');
const character = arg('character', 'madoka');
const games = Number(arg('games', 100));
const samples = Number(arg('samples', 16));
const seed = Number(arg('seed', 2026091501));
const maxActions = Number(arg('max-actions', 300));
const minGain = Number(arg('min-gain', 0.05));
const pair = loadPair(pairFile);

const report = {
  pairFile, character, games, samples, seed, maxActions, minGain,
  baseline: { wins: 0, losses: 0, draws: 0, terminated: 0 },
  planner: { wins: 0, losses: 0, draws: 0, terminated: 0, decisions: 0, deviations: 0, cutoffs: 0 },
  paired: { bothWin: 0, bothLose: 0, plannerOnlyWin: 0, baselineOnlyWin: 0, other: 0 },
  deviationActions: {},
};

for (let game = 0; game < games; game++) {
  const gameSeed = seed + game * 65537;
  const base = playBaseline({ pair, character, seed: gameSeed, maxActions });
  const planner = playPlanner({ pair, character, seed: gameSeed, samples, maxActions, minGain });
  const baseWin = base.winnerCharacter === character;
  const plannerWin = planner.winnerCharacter === character;

  report.baseline.terminated += Number(base.terminated);
  report.planner.terminated += Number(planner.terminated);
  if (baseWin) report.baseline.wins += 1;
  else if (base.winnerCharacter === null) report.baseline.draws += 1;
  else report.baseline.losses += 1;
  if (plannerWin) report.planner.wins += 1;
  else if (planner.winnerCharacter === null) report.planner.draws += 1;
  else report.planner.losses += 1;

  if (baseWin && plannerWin) report.paired.bothWin += 1;
  else if (!baseWin && !plannerWin && base.winnerCharacter !== null && planner.winnerCharacter !== null) report.paired.bothLose += 1;
  else if (!baseWin && plannerWin) report.paired.plannerOnlyWin += 1;
  else if (baseWin && !plannerWin) report.paired.baselineOnlyWin += 1;
  else report.paired.other += 1;

  report.planner.decisions += planner.plannerDecisions;
  report.planner.deviations += planner.deviationCount;
  report.planner.cutoffs += planner.cutoffs;
  for (const [label, count] of Object.entries(planner.deviations)) report.deviationActions[label] = (report.deviationActions[label] ?? 0) + count;
}

report.baseline.winRate = report.baseline.wins / games;
report.planner.winRate = report.planner.wins / games;
report.winRateLift = report.planner.winRate - report.baseline.winRate;
report.planner.deviationRate = report.planner.decisions ? report.planner.deviations / report.planner.decisions : 0;
report.paired.signTestP = signP(report.paired.plannerOnlyWin, report.paired.baselineOnlyWin);
report.topDeviations = Object.entries(report.deviationActions).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([label, count]) => ({ label, count }));

fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  games, samples,
  baseline: `${report.baseline.wins}-${report.baseline.losses}-${report.baseline.draws}`,
  planner: `${report.planner.wins}-${report.planner.losses}-${report.planner.draws}`,
  baselineWinRate: report.baseline.winRate,
  plannerWinRate: report.planner.winRate,
  winRateLift: report.winRateLift,
  paired: report.paired,
  deviationRate: report.planner.deviationRate,
  cutoffs: report.planner.cutoffs,
  topDeviations: report.topDeviations.slice(0, 12),
  output,
}, null, 2));
