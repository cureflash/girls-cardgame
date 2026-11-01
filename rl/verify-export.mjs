import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Policy } from '../src/policy.js';
import { GameEngine } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';

const [policyPath, fixturesPath] = process.argv.slice(2);
if (!policyPath || !fixturesPath) throw new Error('Usage: node rl/verify-export.mjs policy.json parity-fixtures.json');
const policy = new Policy(JSON.parse(readFileSync(policyPath, 'utf8')));
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'));
assert.ok(fixtures.length >= 32, 'Need at least 32 Python reference decisions.');
for (const [i, fixture] of fixtures.entries()) {
  assert.equal(policy.choose(fixture.observation, fixture.legal), fixture.action, `Python/JS action mismatch at fixture ${i}`);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const result = { parityDecisions: fixtures.length, games: 40, wins: 0, losses: 0, truncated: 0, modelDecisions: 0, meanInferenceMs: 0 };
let inferenceMs = 0;
for (let game = 0; game < result.games; game++) {
  const ids = ['madoka', 'mami'];
  const rng = mulberry32(950000 + game);
  const engine = new GameEngine({
    players: ids.map((id, i) => ({ id: `p${i}`, name: id, character: CHARACTERS[id] })),
    decks: ids.map(id => createDeck(id)), openingHand: 5, rng,
  });
  const adapter = new CharacterAdapter(engine);
  const agent = game % 2;
  let actions = 0;
  while (!adapter.info().terminated && actions++ < 600) {
    const player = adapter.currentPlayer(), legal = adapter.legalActions(player);
    let action;
    if (player === agent) {
      const started = performance.now();
      action = policy.choose(adapter.observation(player), legal);
      inferenceMs += performance.now() - started;
      result.modelDecisions++;
    } else action = chooseBaselineAction(adapter, player, rng);
    assert.ok(legal.includes(action), `Illegal decision in game ${game}`);
    adapter.applyAction(action, player);
  }
  const info = adapter.info();
  if (!info.terminated) result.truncated++;
  else result[info.winner === agent ? 'wins' : 'losses']++;
}
result.meanInferenceMs = +(inferenceMs / result.modelDecisions).toFixed(3);
console.log(JSON.stringify(result, null, 2));
assert.equal(result.truncated, 0, 'A browser-model game did not finish within 600 decisions.');
