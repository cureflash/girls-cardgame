import fs from 'node:fs';
import { normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { playGame, MATCH_VARIANTS } from './match.mjs';

const PAIR_FORMAT = 'girls-cardgame-eval-pair-v1';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadPair(argv) {
  const first = argv[0];
  if (!first || first.startsWith('--')) {
    throw new Error('Usage: node ga/evaluate.mjs PAIR.json [--games 1000] OR node ga/evaluate.mjs MADOKA.json MAMI.json [--games 1000]');
  }
  const firstData = JSON.parse(fs.readFileSync(first, 'utf8'));
  if (firstData?.format === PAIR_FORMAT && firstData.madoka && firstData.mami) {
    return { madoka: normalizeEvaluationGenome(firstData.madoka), mami: normalizeEvaluationGenome(firstData.mami) };
  }
  const second = argv[1];
  if (!second || second.startsWith('--')) throw new Error('A Mami genome file is required when the first file is not a pair bundle.');
  return {
    madoka: normalizeEvaluationGenome(firstData),
    mami: normalizeEvaluationGenome(JSON.parse(fs.readFileSync(second, 'utf8'))),
  };
}

const pair = loadPair(process.argv.slice(2));
const games = Math.max(2, Number(arg('--games', 1000)));
const seed = Number(arg('--seed', 1000));
const maxActions = Number(arg('--max-actions', 600));
const result = {
  games: 0,
  truncated: 0,
  madoka: { wins: 0, losses: 0, draws: 0, bySeat: { first: { games: 0, wins: 0, losses: 0, draws: 0 }, second: { games: 0, wins: 0, losses: 0, draws: 0 } } },
  mami: { wins: 0, losses: 0, draws: 0, bySeat: { first: { games: 0, wins: 0, losses: 0, draws: 0 }, second: { games: 0, wins: 0, losses: 0, draws: 0 } } },
};

for (let game = 0; game < games; game++) {
  const detail = playGame(pair.madoka, pair.mami, { variant: game % MATCH_VARIANTS.length, seed: seed + game * 7919, maxActions });
  result.games += 1;
  if (detail.truncated) result.truncated += 1;
  for (const character of ['madoka', 'mami']) {
    const seat = (character === 'madoka' ? detail.madokaSeat : detail.mamiSeat) === 0 ? 'first' : 'second';
    const bucket = result[character].bySeat[seat];
    bucket.games += 1;
    if (detail.winnerCharacter === character) {
      result[character].wins += 1;
      bucket.wins += 1;
    } else if (detail.winnerCharacter === null) {
      result[character].draws += 1;
      bucket.draws += 1;
    } else {
      result[character].losses += 1;
      bucket.losses += 1;
    }
  }
}

for (const character of ['madoka', 'mami']) {
  const completed = Math.max(1, result.games - result.truncated);
  result[character].score = (result[character].wins + 0.5 * result[character].draws) / completed;
  for (const seat of ['first', 'second']) {
    const bucket = result[character].bySeat[seat];
    bucket.score = bucket.games ? (bucket.wins + 0.5 * bucket.draws) / bucket.games : 0;
  }
}

console.log(JSON.stringify(result, null, 2));
