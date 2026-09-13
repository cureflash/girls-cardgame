import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RegretSolver } from './solver.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const iterations = Number(arg('iterations', 500));
const seed = Number(arg('seed', 20260914));
const evaluationGames = Number(arg('evaluation-games', 200));
const rolloutsPerAction = Number(arg('rollouts-per-action', 1));
const maxActions = Number(arg('max-actions', 260));
const exploration = Number(arg('exploration', 0.08));
const top = Number(arg('top', 30));
const output = resolve(arg('output', 'cfr/results/latest.json'));

for (const [name, value] of Object.entries({ iterations, seed, evaluationGames, rolloutsPerAction, maxActions, exploration, top })) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid --${name}: ${value}`);
}

const solver = new RegretSolver({ seed, rolloutsPerAction, maxActions, exploration, fallback: 'baseline' });
const started = Date.now();
solver.train({ iterations, seed });
const report = solver.report({ evaluationGames, top });
report.runtimeMs = Date.now() - started;
report.requestedIterations = iterations;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);

const madoka = report.evaluation.madokaVsBaselineMami;
const mami = report.evaluation.mamiVsBaselineMadoka;
console.log(JSON.stringify({
  algorithm: report.algorithm,
  exactNash: report.exactNash,
  iterations,
  informationSets: report.training.informationSets,
  runtimeMs: report.runtimeMs,
  madoka: {
    wins: madoka.wins,
    losses: madoka.losses,
    draws: madoka.draws,
    winRate: madoka.winRate,
    fallbackRate: madoka.fallbackRate,
    actionCounts: madoka.actionCounts,
  },
  mami: {
    wins: mami.wins,
    losses: mami.losses,
    draws: mami.draws,
    winRate: mami.winRate,
    fallbackRate: mami.fallbackRate,
    actionCounts: mami.actionCounts,
  },
  output,
}, null, 2));
