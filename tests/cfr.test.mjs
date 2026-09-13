import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RegretSolver,
  cloneAdapter,
  createMatch,
  informationKey,
} from '../cfr/solver.mjs';

test('information key does not reveal opponent hand identity or deck order', () => {
  const original = createMatch(12345, false);
  const altered = cloneAdapter(original);
  const opponent = altered.engine.player(1);
  assert.ok(opponent.hand.length > 0);
  opponent.hand[0] = {
    ...opponent.hand[0],
    code: 'hidden-card-replaced',
    name: 'hidden-card-replaced',
    type: 'witch',
    attack: 13,
    rank: 13,
    tributeThreshold: 13,
  };
  opponent.deck.reverse();

  const legalOriginal = original.legalActions(0);
  const legalAltered = altered.legalActions(0);
  assert.deepEqual(legalAltered, legalOriginal);
  assert.equal(
    informationKey(original, 0, legalOriginal),
    informationKey(altered, 0, legalAltered),
  );
});

test('regret solver completes a real-game smoke iteration and records normalized strategies', () => {
  const solver = new RegretSolver({
    seed: 77,
    exploration: 0.1,
    rolloutsPerAction: 1,
    maxActions: 45,
    fallback: 'baseline',
  });
  const training = solver.train({ iterations: 1, seed: 77 });
  assert.equal(training.games, 1);
  assert.ok(training.decisions > 0);
  assert.ok(solver.nodes.size > 0);

  const top = solver.topInformationSets(5);
  assert.ok(top.length > 0);
  for (const node of top) {
    const sum = node.strategy.reduce((total, item) => total + item.probability, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9 || sum === 0);
    assert.ok(node.strategy.every(item => !item.label.includes('hidden-card-replaced')));
  }
});
