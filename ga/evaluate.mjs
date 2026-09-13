import fs from 'node:fs';
import { DEFAULT_GENOME, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { playGame, MATCH_VARIANTS } from './match.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const file = process.argv[2];
if (!file || file.startsWith('--')) throw new Error('Usage: node ga/evaluate.mjs GENOME.json [--opponent FILE.json] [--games 200] [--seed 1000]');
const genome = normalizeEvaluationGenome(JSON.parse(fs.readFileSync(file, 'utf8')));
const opponentFile = arg('--opponent', null);
const opponent = opponentFile ? normalizeEvaluationGenome(JSON.parse(fs.readFileSync(opponentFile, 'utf8'))) : DEFAULT_GENOME;
const games = Math.max(4, Number(arg('--games', 200)));
const seed = Number(arg('--seed', 1000));
const maxActions = Number(arg('--max-actions', 600));
const result = { games: 0, wins: 0, losses: 0, draws: 0, truncated: 0, byRole: {} };

for (let game = 0; game < games; game++) {
  const detail = playGame(genome, opponent, { variant: game % MATCH_VARIANTS.length, seed: seed + game * 7919, maxActions });
  result.games++;
  if (detail.winnerController === 0) result.wins++;
  else if (detail.winnerController === 1) result.losses++;
  else result.draws++;
  if (detail.truncated) result.truncated++;
  const role = `${detail.aCharacter}-${detail.aSeat === 0 ? 'first' : 'second'}`;
  result.byRole[role] ??= { games: 0, wins: 0, losses: 0, draws: 0 };
  const bucket = result.byRole[role];
  bucket.games++;
  if (detail.winnerController === 0) bucket.wins++;
  else if (detail.winnerController === 1) bucket.losses++;
  else bucket.draws++;
}

const completed = Math.max(1, result.games - result.truncated);
console.log(JSON.stringify({ ...result, score: (result.wins + 0.5 * result.draws) / completed }, null, 2));
