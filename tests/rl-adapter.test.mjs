import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, CARD_TYPES } from '../src/game-engine.js';
import {
  ACTIONS,
  OBSERVATION_SIZE,
  RLAdapter,
  encodeAttack,
  encodeChain,
  encodeSummon,
} from '../src/rl-adapter.js';

const familiar = (id, attack) => ({ id, name: id, type: CARD_TYPES.FAMILIAR, attack, rank: attack });
const boost = (id, value) => ({ id, name: id, type: CARD_TYPES.MAGIC, effect: 'boost', chainable: true, value });

function makeEngine() {
  const padA = Array.from({ length: 20 }, (_, i) => familiar(`a-pad-${i}`, 2));
  const padB = Array.from({ length: 20 }, (_, i) => familiar(`b-pad-${i}`, 2));
  return new GameEngine({
    players: [
      { id: 'p1', name: 'A', character: { id: 'madoka', name: '鹿目まどか' } },
      { id: 'p2', name: 'B', character: { id: 'mami', name: '巴マミ' } },
    ],
    decks: [padA, padB],
    openingHand: 0,
    rng: () => 0.999999,
  });
}

test('observation has fixed size and does not reveal opponent hand identity', () => {
  const e = makeEngine();
  const a = new RLAdapter(e);
  e.player(1).hand = [familiar('hidden-3', 3)];
  const first = a.observation(0);
  e.player(1).hand = [familiar('hidden-13', 13)];
  const second = a.observation(0);
  assert.equal(first.length, OBSERVATION_SIZE);
  assert.deepEqual(first, second);
});

test('legal action mask exposes summons and end turn through the adapter', () => {
  const e = makeEngine();
  e.player(0).hand = [familiar('f3', 3)];
  const a = new RLAdapter(e);
  const legal = a.legalActions(0);
  assert.ok(legal.includes(ACTIONS.END_TURN));
  assert.ok(legal.includes(encodeSummon(0, 0)));
  assert.equal(a.actionMask(0)[encodeSummon(0, 0)], 1);
});

test('battle chain response is represented as a masked fixed action', () => {
  const e = makeEngine();
  e.state.turn = 2;
  e.state.activePlayer = 0;
  e.state.priorityPlayer = 0;
  e.player(0).field[0] = familiar('atk', 5);
  e.player(1).field[0] = familiar('def', 8);
  e.player(0).hand = [boost('s10', 10)];
  e.player(1).hand = [boost('s6', 6)];
  const a = new RLAdapter(e);
  a.applyAction(encodeAttack(0, 0), 0);
  assert.equal(a.currentPlayer(), 0);
  assert.ok(a.legalActions(0).includes(encodeChain(0)));
});
