import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateActions,
  determinizeForPlayer,
  evaluateBestResponse,
} from '../br/rollout-best-response.mjs';
import { createMatch, seededRng } from '../cfr/solver.mjs';

test('determinization preserves own hand and public zones while resampling hidden zones', () => {
  const adapter = createMatch(4242, false);
  const perspective = 0;
  const beforeSelfHand = adapter.engine.player(perspective).hand.map(card => card.id);
  const beforeOppField = adapter.engine.player(1).field.map(card => card?.id ?? null);
  const beforeOppGrave = adapter.engine.player(1).graveyard.map(card => card.id);
  const beforeOppHandCount = adapter.engine.player(1).hand.length;
  const beforeOppDeckCount = adapter.engine.player(1).deck.length;

  const a = determinizeForPlayer(adapter, perspective, seededRng(1));
  const b = determinizeForPlayer(adapter, perspective, seededRng(2));

  assert.deepEqual(a.engine.player(perspective).hand.map(card => card.id), beforeSelfHand);
  assert.deepEqual(a.engine.player(1).field.map(card => card?.id ?? null), beforeOppField);
  assert.deepEqual(a.engine.player(1).graveyard.map(card => card.id), beforeOppGrave);
  assert.equal(a.engine.player(1).hand.length, beforeOppHandCount);
  assert.equal(a.engine.player(1).deck.length, beforeOppDeckCount);
  assert.equal(a.engine.player(perspective).deck.length, adapter.engine.player(perspective).deck.length);
  assert.notDeepEqual(
    [...a.engine.player(1).hand, ...a.engine.player(1).deck].map(card => card.id),
    [...b.engine.player(1).hand, ...b.engine.player(1).deck].map(card => card.id),
  );
});

test('strategic candidate reduction keeps only legal concrete actions', () => {
  const adapter = createMatch(991, false);
  const player = adapter.currentPlayer();
  const legal = new Set(adapter.legalActions(player));
  const candidates = candidateActions(adapter, player);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every(candidate => legal.has(candidate.action)));
  assert.equal(new Set(candidates.map(candidate => candidate.action)).size, candidates.length);
});

test('rollout best response completes a short real-game evaluation', () => {
  const result = evaluateBestResponse({
    character: 'madoka',
    games: 2,
    samples: 2,
    seed: 555,
    maxActions: 160,
  });
  assert.equal(result.games, 2);
  assert.equal(result.wins + result.losses + result.draws, 2);
  assert.ok(result.plannerDecisions > 0);
  assert.ok(Number.isFinite(result.winRate));
});
