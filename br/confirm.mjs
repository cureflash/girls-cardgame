import fs from 'node:fs';
import path from 'node:path';
import { PHASES } from '../src/game-engine.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';
import { createMatch } from '../cfr/solver.mjs';
import { playBestResponseGameV2 } from './rollout-best-response-v2.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function baselineGame({ character, seed, maxActions }) {
  const swapped = character === 'madoka' ? Boolean(seed & 1) : !Boolean(seed & 1);
  const adapter = createMatch(seed, swapped);
  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    let action = legal.length === 1 ? legal[0] : chooseBaselineAction(adapter, player);
    if (!legal.includes(action)) action = legal[0];
    adapter.applyAction(action, player);
  }
  const winner = adapter.engine.state.winner;
  return {
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
    winnerCharacter: winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id,
  };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let value = 1;
  for (let i = 1; i <= k; i++) value = value * (n - k + i) / i;
  return value;
}

function pairedSignP(plannerOnly, baselineOnly) {
  const n = plannerOnly + baselineOnly;
  if (!n) return 1;
  const k = Math.min(plannerOnly, baselineOnly);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += choose(n, i) * Math.pow(0.5, n);
  return Math.min(1, 2 * tail);
}

const character = arg('character', 'madoka');
const games = Number(arg('games', 100));
const samples = Number(arg('samples', 16));
const seed = Number(arg('seed', 910001));
const maxActions = Number(arg('max-actions', 220));
const minGain = Number(arg('min-gain', 0.05));
const output = arg('output', 'br/best-response-confirmation.json');

const report = {
  generatedAt: new Date().toISOString(),
  character,
  games,
  samples,
  seed,
  maxActions,
  minGain,
  baseline: { wins: 0, losses: 0, draws: 0, terminated: 0 },
  planner: { wins: 0, losses: 0, draws: 0, terminated: 0, plannerDecisions: 0, deviations: 0, rolloutCutoffs: 0 },
  paired: { bothWin: 0, bothLose: 0, plannerOnlyWin: 0, baselineOnlyWin: 0, other: 0 },
  deviationActions: {},
  selectedActions: {},
};

for (let game = 0; game < games; game++) {
  const gameSeed = seed + game * 65537;
  const base = baselineGame({ character, seed: gameSeed, maxActions });
  const planner = playBestResponseGameV2({ character, seed: gameSeed, samples, maxActions, minGain });
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

  report.planner.plannerDecisions += planner.plannerDecisions;
  report.planner.deviations += planner.deviations;
  report.planner.rolloutCutoffs += planner.rolloutCutoffs;
  for (const [label, count] of Object.entries(planner.actionCounts)) {
    report.selectedActions[label] = (report.selectedActions[label] ?? 0) + count;
  }
  for (const decision of planner.decisionStats) {
    if (!decision.deviated) continue;
    report.deviationActions[decision.label] = (report.deviationActions[decision.label] ?? 0) + 1;
  }
}

report.baseline.winRate = report.baseline.wins / games;
report.planner.winRate = report.planner.wins / games;
report.observedWinRateLift = report.planner.winRate - report.baseline.winRate;
report.planner.deviationRate = report.planner.plannerDecisions
  ? report.planner.deviations / report.planner.plannerDecisions
  : 0;
report.paired.signTestP = pairedSignP(report.paired.plannerOnlyWin, report.paired.baselineOnlyWin);
report.topDeviations = Object.entries(report.deviationActions)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([label, count]) => ({ label, count }));
report.topSelectedActions = Object.entries(report.selectedActions)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([label, count]) => ({ label, count }));

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  games,
  samples,
  baseline: `${report.baseline.wins}-${report.baseline.losses}-${report.baseline.draws}`,
  planner: `${report.planner.wins}-${report.planner.losses}-${report.planner.draws}`,
  baselineWinRate: report.baseline.winRate,
  plannerWinRate: report.planner.winRate,
  observedWinRateLift: report.observedWinRateLift,
  paired: report.paired,
  deviationRate: report.planner.deviationRate,
  topDeviations: report.topDeviations.slice(0, 12),
  output,
}, null, 2));
