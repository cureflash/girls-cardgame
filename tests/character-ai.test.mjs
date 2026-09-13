import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GENOME } from '../src/evaluation-ai.js';
import { baselineGenome } from '../src/baseline-ai.js';
import { MATCH_VARIANTS, playSeries } from '../ga/match.mjs';

test('browser baseline exposes separate Madoka and Mami policy slots', () => {
  const pair = baselineGenome();
  assert.ok(pair.madoka);
  assert.ok(pair.mami);
  assert.equal(baselineGenome('madoka'), pair.madoka);
  assert.equal(baselineGenome('mami'), pair.mami);
});

test('character-bound series evaluates both seat arrangements', () => {
  const result = playSeries(DEFAULT_GENOME, DEFAULT_GENOME, { seed: 123, repeats: 2, maxActions: 600 });
  assert.equal(MATCH_VARIANTS.length, 2);
  assert.equal(result.games, 4);
  assert.equal(result.winsMadoka + result.winsMami + result.draws, result.games);
  assert.deepEqual(new Set(result.details.map(detail => detail.madokaSeat)), new Set([0, 1]));
  assert.deepEqual(new Set(result.details.map(detail => detail.mamiSeat)), new Set([0, 1]));
  for (const detail of result.details) {
    assert.ok(['madoka', 'mami', null].includes(detail.winnerCharacter));
    assert.equal(detail.madokaSeat + detail.mamiSeat, 1);
  }
});
