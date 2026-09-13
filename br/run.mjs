import fs from 'node:fs';
import path from 'node:path';
import { evaluateBaselineControl } from './rollout-best-response.mjs';
import { evaluateBestResponseV2 } from './rollout-best-response-v2.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const character = arg('character', 'madoka');
const games = Number(arg('games', 40));
const samples = Number(arg('samples', 16));
const seed = Number(arg('seed', 910001));
const maxActions = Number(arg('max-actions', 220));
const minGain = Number(arg('min-gain', 0.05));
const output = arg('output', 'br/best-response-report.json');

if (!['madoka', 'mami'].includes(character)) throw new Error('character must be madoka or mami');
if (!Number.isInteger(games) || games <= 0) throw new Error('games must be a positive integer');
if (!Number.isInteger(samples) || samples <= 0) throw new Error('samples must be a positive integer');
if (!Number.isFinite(minGain) || minGain < 0 || minGain > 1) throw new Error('min-gain must be between 0 and 1');

const baseline = evaluateBaselineControl({ character, games, seed, maxActions });
const bestResponse = evaluateBestResponseV2({ character, games, samples, seed, maxActions, minGain });
const report = {
  generatedAt: new Date().toISOString(),
  character,
  games,
  samples,
  seed,
  maxActions,
  minGain,
  baseline,
  bestResponse,
  observedWinRateLift: bestResponse.winRate - baseline.winRate,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  character,
  games,
  samples,
  minGain,
  baselineWinRate: baseline.winRate,
  bestResponseWinRate: bestResponse.winRate,
  observedWinRateLift: report.observedWinRateLift,
  plannerDecisions: bestResponse.plannerDecisions,
  deviations: bestResponse.deviations,
  deviationRate: bestResponse.deviationRate,
  meanAcceptedGain: bestResponse.meanAcceptedGain,
  rolloutCutoffs: bestResponse.rolloutCutoffs,
  topActions: Object.entries(bestResponse.actionCounts).sort((a, b) => b[1] - a[1]).slice(0, 12),
  output,
}, null, 2));
