import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { GameEngine, PHASES } from '../src/three-character-engine.js';
import { ThreeCharacterAdapter } from '../src/three-character-adapter.js';
import { ACTIONS } from '../src/rl-adapter.js';

function makeEngine() {
  return new GameEngine({
    players: [
      { id: 'p0', name: CHARACTERS.kyoko.name, character: CHARACTERS.kyoko },
      { id: 'p1', name: CHARACTERS.madoka.name, character: CHARACTERS.madoka },
    ],
    decks: [createDeck('kyoko'), createDeck('madoka')],
    rng: () => 0.5,
  });
}

function mechanicalDeck(character) {
  return createDeck(character).map(card => ({
    type: card.type,
    attack: card.attack ?? null,
    rank: card.rank ?? null,
    tributeThreshold: card.tributeThreshold ?? null,
    effect: card.effect ?? null,
    value: card.value ?? null,
    chainable: card.chainable ?? null,
  }));
}

function setBattleStart(engine) {
  engine.state.phase = PHASES.BATTLE_START;
  engine.state.activePlayer = 0;
  engine.state.priorityPlayer = 0;
  engine.state.pendingDecision = null;
  engine.state.turn = 5;
  engine.player(0).specialUsed = false;
}

function firstBy(deck, type, attack) {
  return { ...deck.find(card => card.type === type && card.attack === attack) };
}

test('Kyoko deck is mechanically identical to the other three and has no passive bonus', () => {
  const base = mechanicalDeck('madoka');
  for (const character of ['mami', 'sayaka', 'kyoko']) assert.deepEqual(mechanicalDeck(character), base);
  assert.equal(base.length, 30);
  assert.equal(CHARACTERS.kyoko.passive, 'なし');
  assert.deepEqual([...new Set(createDeck('kyoko').filter(card => card.type === 'witch').map(card => card.tributeThreshold))].sort((a, b) => a - b), [8, 10, 13]);
});

test('Kyoko can use one opposing ATK 10 monster plus her own ATK 3 familiar to summon an ATK 13 witch', () => {
  const engine = makeEngine();
  const adapter = new ThreeCharacterAdapter(engine);
  const own = engine.player(0);
  const opponent = engine.player(1);
  const ownDeck = createDeck('kyoko');
  const oppDeck = createDeck('madoka');
  const witch13 = firstBy(ownDeck, 'witch', 13);
  const familiar3 = firstBy(ownDeck, 'familiar', 3);
  const target10 = firstBy(oppDeck, 'witch', 10);
  own.hand = [witch13, familiar3];
  own.field = Array(5).fill(null);
  own.graveyard = [];
  opponent.field = [target10, null, null, null, null];
  opponent.graveyard = [];
  setBattleStart(engine);

  assert.equal(engine.canUseSpecial(0), true);
  adapter.applyAction(ACTIONS.SPECIAL, 0);
  assert.equal(engine.state.pendingDecision.type, 'KYOKO_OPPONENT_TRIBUTE');
  adapter.applyAction(adapter.legalActions(0)[0], 0);
  assert.equal(engine.state.pendingDecision.type, 'KYOKO_WITCH_SUMMON');
  const summonActions = adapter.legalActions(0);
  assert.ok(summonActions.length > 0);
  adapter.applyAction(summonActions[0], 0);

  assert.equal(opponent.field[0], null);
  assert.equal(opponent.graveyard.some(card => card.id === target10.id), true);
  assert.equal(own.graveyard.some(card => card.id === familiar3.id), true);
  assert.equal(own.field.some(card => card?.id === witch13.id), true);
  assert.equal(own.specialUsed, true);
  assert.equal(engine.state.turn, 6);
  assert.equal(engine.state.activePlayer, 1);
  const event = engine.state.events.find(item => item.type === 'opponentTribute');
  assert.equal(event?.card.id, target10.id);
});

test('Kyoko can summon an ATK 13 witch using only one opposing ATK 13 monster as tribute', () => {
  const engine = makeEngine();
  const adapter = new ThreeCharacterAdapter(engine);
  const own = engine.player(0);
  const opponent = engine.player(1);
  const witch13 = firstBy(createDeck('kyoko'), 'witch', 13);
  const target13 = firstBy(createDeck('madoka'), 'witch', 13);
  own.hand = [witch13];
  own.field = Array(5).fill(null);
  own.graveyard = [];
  opponent.field = [target13, null, null, null, null];
  opponent.graveyard = [];
  setBattleStart(engine);

  adapter.applyAction(ACTIONS.SPECIAL, 0);
  adapter.applyAction(adapter.legalActions(0)[0], 0);
  const summonActions = adapter.legalActions(0);
  assert.ok(summonActions.length > 0);
  adapter.applyAction(summonActions[0], 0);

  assert.equal(own.graveyard.length, 0);
  assert.equal(own.field.some(card => card?.id === witch13.id), true);
  assert.equal(opponent.graveyard.filter(card => card.id === target13.id).length, 1);
});

test('Kyoko special tributes only the selected opposing monster and leaves other opposing monsters in play', () => {
  const engine = makeEngine();
  const adapter = new ThreeCharacterAdapter(engine);
  const own = engine.player(0);
  const opponent = engine.player(1);
  const ownDeck = createDeck('kyoko');
  const oppDeck = createDeck('madoka');
  own.hand = [firstBy(ownDeck, 'witch', 8)];
  own.field = Array(5).fill(null);
  opponent.field = [firstBy(oppDeck, 'witch', 8), firstBy(oppDeck, 'witch', 10), null, null, null];
  const untouchedId = opponent.field[1].id;
  setBattleStart(engine);

  adapter.applyAction(ACTIONS.SPECIAL, 0);
  const targetActions = adapter.legalActions(0);
  assert.equal(targetActions.length, 2);
  adapter.applyAction(targetActions[0], 0);
  adapter.applyAction(adapter.legalActions(0)[0], 0);

  assert.equal(opponent.field[0], null);
  assert.equal(opponent.field[1]?.id, untouchedId);
  assert.equal(opponent.graveyard.length, 1);
});

test('Kyoko cannot activate her special unless an opposing monster can contribute to a legal witch summon', () => {
  const engine = makeEngine();
  const own = engine.player(0);
  const opponent = engine.player(1);
  const ownDeck = createDeck('kyoko');
  const oppDeck = createDeck('madoka');
  own.hand = [firstBy(ownDeck, 'witch', 13)];
  own.field = Array(5).fill(null);
  opponent.field = [firstBy(oppDeck, 'familiar', 3), null, null, null, null];
  setBattleStart(engine);
  assert.equal(engine.canUseSpecial(0), false);

  own.hand.push(firstBy(ownDeck, 'familiar', 5), { ...ownDeck.find(card => card.type === 'familiar' && card.attack === 5), id: 'extra-familiar-5' });
  assert.equal(engine.canUseSpecial(0), true);
});
