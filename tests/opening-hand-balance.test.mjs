import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/three-character-engine.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';

function start(a, b = 'madoka') {
  return new GameEngine({
    players: [a, b].map((id, index) => ({ id: `p${index}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: [createDeck(a), createDeck(b)],
    rng: () => 0.5,
  });
}

test('current opening-hand skills are applied exactly', () => {
  const expected = {
    madoka: 5,
    mami: 5,
    sayaka: 5,
    kyoko: 4,
    homura: 8,
  };

  for (const [id, handSize] of Object.entries(expected)) {
    const engine = start(id);
    assert.equal(engine.player(0).hand.length, handSize, `${id} opening hand`);
    assert.equal(engine.player(0).deck.length, 30 - handSize, `${id} remaining deck`);
    const drawEvent = engine.state.events.find(event => event.type === 'draw' && event.player === 0);
    assert.equal(drawEvent?.count, handSize, `${id} initial draw event`);
  }
});

test('Mami no longer receives the former +1 opening hand', () => {
  const engine = start('mami', 'madoka');
  assert.equal(engine.player(0).hand.length, 5);
  assert.equal(engine.player(1).hand.length, 5);
});

test('Kyoko and Homura retain their specials while only opening hand changes', () => {
  const kyoko = start('kyoko');
  const homura = start('homura');
  assert.equal(kyoko.player(0).character.special, '相手の使い魔・魔女1体を生贄にして魔女召喚');
  assert.equal(homura.player(0).character.special, '発動ターン中、相手はチェーン不可');
});
