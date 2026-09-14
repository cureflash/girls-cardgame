import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { GameEngine, PHASES } from '../src/three-character-engine.js';
import { ThreeCharacterAdapter } from '../src/three-character-adapter.js';
import { ACTIONS } from '../src/rl-adapter.js';

function makeEngine() {
  return new GameEngine({
    players: [
      { id: 'p0', name: CHARACTERS.sayaka.name, character: CHARACTERS.sayaka },
      { id: 'p1', name: CHARACTERS.madoka.name, character: CHARACTERS.madoka },
    ],
    decks: [createDeck('sayaka'), createDeck('madoka')],
    rng: () => 0.5,
  });
}

test('Sayaka deck keeps 30 cards and reduces witch tribute thresholds by one', () => {
  const deck = createDeck('sayaka');
  assert.equal(deck.length, 30);
  const thresholds = deck.filter(card => card.type === 'witch').map(card => [card.attack, card.tributeThreshold]);
  assert.deepEqual([...new Set(thresholds.map(JSON.stringify))].map(JSON.parse).sort((a, b) => a[0] - b[0]), [
    [8, 7],
    [10, 9],
    [13, 12],
  ]);

  const engine = makeEngine();
  const p = engine.player(0);
  const source = createDeck('sayaka');
  const witch8 = source.find(card => card.type === 'witch' && card.attack === 8);
  const familiar3 = source.find(card => card.type === 'familiar' && card.attack === 3);
  const familiar4 = source.find(card => card.type === 'familiar' && card.attack === 4);
  p.hand = [{ ...witch8 }, { ...familiar3 }, { ...familiar4 }];
  p.field = Array(5).fill(null);
  p.summonedThisTurn = false;
  engine.state.phase = PHASES.MAIN;
  engine.state.activePlayer = 0;
  engine.state.priorityPlayer = 0;
  engine.state.pendingDecision = null;

  const plans = engine.validTributeSets(0, p.hand[0]);
  assert.ok(plans.some(plan => plan.total === 7 && plan.handIds.length === 2));
});

test('Sayaka special returns any three graveyard cards to the bottom of the deck and ends the turn', () => {
  const engine = makeEngine();
  const adapter = new ThreeCharacterAdapter(engine);
  const p = engine.player(0);
  const cards = createDeck('sayaka').slice(0, 3).map(card => ({ ...card }));
  const expectedIds = cards.map(card => card.id);
  p.graveyard = cards;
  p.deck = p.deck.slice(0, 9);
  p.specialUsed = false;
  engine.state.phase = PHASES.BATTLE_START;
  engine.state.activePlayer = 0;
  engine.state.priorityPlayer = 0;
  engine.state.pendingDecision = null;
  engine.state.turn = 5;

  assert.equal(engine.canUseSpecial(0), true);
  const beforeDeck = p.deck.length;
  adapter.applyAction(ACTIONS.SPECIAL, 0);
  assert.equal(engine.state.pendingDecision.type, 'SAYAKA_RECYCLE');
  assert.equal(engine.state.pendingDecision.options.length, 3);

  for (let i = 0; i < 3; i++) {
    const legal = adapter.legalActions(0);
    assert.equal(legal.length, 3 - i);
    adapter.applyAction(legal[0], 0);
  }

  assert.equal(p.graveyard.length, 0);
  assert.equal(p.deck.length, beforeDeck + 3);
  assert.deepEqual(p.deck.slice(-3).map(card => card.id), expectedIds);
  assert.equal(p.specialUsed, true);
  assert.equal(engine.state.pendingDecision, null);
  assert.equal(engine.state.turn, 6);
  assert.equal(engine.state.activePlayer, 1);
});
