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
    mami: 4,
    sayaka: 5,
    kyoko: 5,
    homura: 6,
  };

  for (const [id, handSize] of Object.entries(expected)) {
    const engine = start(id);
    assert.equal(engine.player(0).hand.length, handSize, `${id} opening hand`);
    assert.equal(engine.player(0).deck.length, 30 - handSize, `${id} remaining deck`);
    const drawEvent = engine.state.events.find(event => event.type === 'draw' && event.player === 0);
    assert.equal(drawEvent?.count, handSize, `${id} initial draw event`);
  }
});

test('Mami starts with one fewer card', () => {
  const engine = start('mami', 'madoka');
  assert.equal(engine.player(0).hand.length, 4);
  assert.equal(engine.player(1).hand.length, 5);
  assert.equal(CHARACTERS.mami.passive, '初期手札が1枚少ない');
});

test('Kyoko has no passive and keeps her special', () => {
  const kyoko = start('kyoko');
  assert.equal(kyoko.player(0).hand.length, 5);
  assert.equal(kyoko.player(0).character.passive, 'なし');
  assert.equal(kyoko.player(0).character.special, '相手の使い魔・魔女1体を生贄にして魔女召喚');
});

test('Homura starts with one extra card and advertises her expanded special', () => {
  const homura = start('homura');
  assert.equal(homura.player(0).hand.length, 6);
  assert.equal(homura.player(0).character.passive, '初期手札が1枚多い');
  assert.equal(homura.player(0).character.special, '戦闘前に手札の使い魔・魔女1体を生贄なしで追加召喚可能＋発動ターン中、相手はチェーン不可');
});
