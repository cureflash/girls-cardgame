import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck, createPlayerDeck, createNpcDeck } from '../src/card-data.js';

function mechanical(deck) {
  return deck.map(card => ({
    type: card.type,
    attack: card.attack ?? null,
    rank: card.rank ?? null,
    tributeThreshold: card.tributeThreshold ?? null,
    effect: card.effect ?? null,
    value: card.value ?? null,
    chainable: card.chainable ?? null,
  }));
}

test('all five characters expose WebP portraits and intended opening hand modifiers', () => {
  const expected = { madoka: 0, mami: 0, sayaka: 0, kyoko: -1, homura: 3 };
  for (const [id, modifier] of Object.entries(expected)) {
    assert.equal(CHARACTERS[id].openingHandModifier, modifier, `${id} opening modifier`);
    assert.match(CHARACTERS[id].image, /^\.\/assets\/characters\/.+\.webp$/);
  }
});

test('browser player always gets Salvation visual deck and NPC always gets Walpurgis visual deck', () => {
  for (const character of Object.keys(CHARACTERS)) {
    const player = createPlayerDeck(character);
    const npc = createNpcDeck(character);
    assert.equal(player.length, 30);
    assert.equal(npc.length, 30);
    assert.deepEqual(mechanical(player), mechanical(npc), `${character} skins must remain mechanically identical`);

    assert.ok(player.some(card => card.name === '救済の魔女' && card.attack === 13));
    assert.equal(player.some(card => card.name === 'ワルプルギスの夜'), false);
    assert.ok(player.filter(card => card.type === 'familiar' || card.type === 'witch')
      .every(card => card.image.includes('/assets/cards/madoka/')));

    assert.ok(npc.some(card => card.name === 'ワルプルギスの夜' && card.attack === 13));
    assert.equal(npc.some(card => card.name === '救済の魔女'), false);
    assert.ok(npc.filter(card => card.type === 'familiar' || card.type === 'witch')
      .every(card => card.image.includes('/assets/cards/mami/')));
  }
});

test('browser mirror matches use unique card ids across player and NPC decks', () => {
  const player = createPlayerDeck('homura');
  const npc = createNpcDeck('homura');
  const playerIds = new Set(player.map(card => card.id));
  assert.equal(playerIds.size, 30);
  assert.equal(new Set(npc.map(card => card.id)).size, 30);
  assert.equal(npc.some(card => playerIds.has(card.id)), false);
});

test('createDeck remains safe as an Array.map callback for analysis code', () => {
  const decks = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura'].map(createDeck);
  assert.deepEqual(decks.map(deck => deck.length), [30, 30, 30, 30, 30]);
});

test('canonical five-character engine applies exact starting hands and adapter initializes for every character', () => {
  const expectedHands = { madoka: 5, mami: 5, sayaka: 5, kyoko: 4, homura: 8 };
  for (const [id, handSize] of Object.entries(expectedHands)) {
    const engine = new GameEngine({
      players: [
        { id: 'p0', name: CHARACTERS[id].name, character: CHARACTERS[id] },
        { id: 'p1', name: CHARACTERS.madoka.name, character: CHARACTERS.madoka },
      ],
      decks: [createPlayerDeck(id), createNpcDeck('madoka')],
      rng: () => 0.5,
    });
    const adapter = new CharacterAdapter(engine);
    assert.equal(engine.player(0).hand.length, handSize, id);
    assert.ok(adapter.legalActions(adapter.currentPlayer()).length > 0, `${id} must have legal browser actions`);
  }
});
