import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, CARD_TYPES, PHASES } from '../src/character-engine.js';

const familiar = (id, attack) => ({ id, name: id, type: CARD_TYPES.FAMILIAR, attack, rank: attack });
const boost = (id, value) => ({ id, name: id, type: CARD_TYPES.MAGIC, chainable: true, effect: 'boost', value });
const shield = id => ({ id, name: id, type: CARD_TYPES.MAGIC, chainable: true, effect: 'nullifyDamage' });

const characters = [
  { id: 'madoka', name: '鹿目まどか', openingHandModifier: 0 },
  { id: 'mami', name: '巴マミ', openingHandModifier: 0 },
];

function makeEngine() {
  const deck = prefix => Array.from({ length: 20 }, (_, i) => familiar(`${prefix}${i}`, 2));
  return new GameEngine({
    players: [
      { id: 'p0', name: 'P0', character: characters[0] },
      { id: 'p1', name: 'P1', character: characters[1] },
    ],
    decks: [deck('a'), deck('b')],
    openingHand: 0,
    rng: () => 0.999999,
  });
}

function makeHomuraEngine() {
  const deck = prefix => Array.from({ length: 20 }, (_, i) => familiar(`${prefix}${i}`, 2));
  return new GameEngine({
    players: [
      { id: 'p0', name: 'P0', character: { id: 'madoka', name: '鹿目まどか', openingHandModifier: 0 } },
      { id: 'p1', name: 'ほむら', character: { id: 'homura', name: '暁美ほむら', openingHandModifier: 1 } },
    ],
    decks: [deck('a'), deck('b')],
    openingHand: 0,
    rng: () => 0.999999,
  });
}

function enterBattleAsPlayer1(engine) {
  engine.endTurn(0);
  engine.enterBattlePhase(1);
  engine.continueBattlePhase(1);
}

test('attacking side cannot use shield as the first chain action', () => {
  const e = makeEngine();
  e.player(1).field[0] = familiar('attacker', 8);
  e.player(0).field[0] = familiar('defender', 8);
  e.player(1).hand = [shield('opening-shield')];

  enterBattleAsPlayer1(e);
  e.attack(1, 0, 0);

  assert.equal(e.state.pendingDecision, null);
  assert.equal(e.player(1).hand.some(card => card.id === 'opening-shield'), true);
  assert.equal(e.player(1).field[0], null);
  assert.equal(e.player(0).field[0], null);
  assert.equal(e.state.phase, PHASES.BATTLE);
  assert.equal(e.state.battlePhaseEnded, false);
});

test('defending side shield preserves both monsters on an equal battle', () => {
  const e = makeEngine();
  e.player(1).field[0] = familiar('attacker', 8);
  e.player(0).field[0] = familiar('defender', 8);
  e.player(0).hand = [shield('defender-shield')];

  enterBattleAsPlayer1(e);
  e.attack(1, 0, 0);

  assert.equal(e.state.pendingDecision?.type, 'CHAIN_RESPONSE');
  assert.equal(e.state.pendingDecision?.player, 0);
  assert.deepEqual(e.state.pendingDecision?.options, ['defender-shield']);

  e.respondChain(0, 'defender-shield');
  assert.equal(e.player(1).field[0]?.id, 'attacker');
  assert.equal(e.player(0).field[0]?.id, 'defender');
  assert.equal(e.state.battlePhaseEnded, true);
});

test('attacking side may use shield after another chain card has started the chain', () => {
  const e = makeEngine();
  e.player(1).field[0] = familiar('attacker', 5);
  e.player(0).field[0] = familiar('defender', 8);
  e.player(1).hand = [boost('boost-first', 1), shield('later-shield')];

  enterBattleAsPlayer1(e);
  e.attack(1, 0, 0);

  assert.equal(e.state.pendingDecision?.player, 1);
  assert.deepEqual(e.state.pendingDecision?.options, ['boost-first']);

  e.respondChain(1, 'boost-first');
  assert.equal(e.state.pendingDecision?.player, 1);
  assert.deepEqual(e.state.pendingDecision?.options, ['later-shield']);

  e.respondChain(1, 'later-shield');
  assert.equal(e.player(1).field[0]?.id, 'attacker');
  assert.equal(e.player(0).field[0]?.id, 'defender');
  assert.equal(e.state.battlePhaseEnded, true);
});

test('shield also preserves the non-shield side when the shield user would win', () => {
  const e = makeEngine();
  e.player(1).field[0] = familiar('attacker', 8);
  e.player(0).field[0] = familiar('defender', 5);
  e.player(1).hand = [shield('attacker-shield')];
  e.player(0).hand = [boost('defender-boost', 1)];

  enterBattleAsPlayer1(e);
  e.attack(1, 0, 0);
  assert.equal(e.state.pendingDecision?.player, 0);
  e.respondChain(0, 'defender-boost');
  assert.equal(e.state.pendingDecision?.player, 1);
  e.respondChain(1, 'attacker-shield');

  assert.equal(e.player(1).field[0]?.id, 'attacker');
  assert.equal(e.player(0).field[0]?.id, 'defender');
  assert.equal(e.state.battlePhaseEnded, true);
});

test('Homura attack-up cards use their printed value without the removed +2 passive', () => {
  const e = makeHomuraEngine();
  e.player(1).field[0] = familiar('homura', 3);
  e.player(0).field[0] = familiar('defender', 6);
  e.player(1).hand = [boost('boost', 2)];

  enterBattleAsPlayer1(e);
  e.attack(1, 0, 0);
  e.respondChain(1, 'boost');
  e.respondChain(1, null);

  const battle = e.state.events.filter(event => event.type === 'battleEnd').at(-1);
  assert.equal(battle?.attackValue, 5);
  assert.equal(e.player(1).field[0], null);
  assert.equal(e.player(0).field[0]?.id, 'defender');
});
