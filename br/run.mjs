import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateBaselineControl,
  evaluateBestResponse,
} from './rollout-best-response.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const character = arg('character', 'madoka');
const games = Number(arg('games', 40));
const samples = Number(arg('samples', 8));
const seed = Number(arg('seed', 910001));
const maxActions = Number(arg('max-actions', 220));
const output = arg('output', 'br/best-response-report.json');

if (!['madoka', 'mami'].includes(character)) throw new Error('character must be madoka or mami');
if (!Number.isInteger(games) || games <= 0) throw new Error('games must be a positive integer');
if (!Number.isInteger(samples) || samples <= 0) throw new Error('samples must be a positive integer');

const baseline = evaluateBaselineControl({ character, games, seed, maxActions });
const bestResponse = evaluateBestResponse({ character, games, samples, seed, maxActions });
const report = {
  generatedAt: new Date().toISOString(),
  character,
  games,
  samples,
  seed,
  maxActions,
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
  baselineWinRate: baseline.winRate,
  bestResponseWinRate: bestResponse.winRate,
  observedWinRateLift: report.observedWinRateLift,
  plannerDecisions: bestResponse.plannerDecisions,
  rolloutCutoffs: bestResponse.rolloutCutoffs,
  topActions: Object.entries(bestResponse.actionCounts).sort((a, b) => b[1] - a[1]).slice(0, 12),
  output,
}, null, 2));
