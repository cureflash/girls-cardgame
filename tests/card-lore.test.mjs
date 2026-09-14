import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerDeck, createNpcDeck } from '../src/card-data.js';
import { CARD_TYPES } from '../src/game-engine.js';
import { cardLore } from '../src/card-lore.js';

test('every familiar and witch in both browser decks has lore', () => {
  for (const deck of [createPlayerDeck('madoka'), createNpcDeck('mami')]) {
    for (const card of deck) {
      if ([CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type)) {
        assert.ok(cardLore(card), `missing lore for ${card.code}`);
      } else {
        assert.equal(cardLore(card), null);
      }
    }
  }
});

test('internal familiar ids map to the intended lore', () => {
  assert.match(cardLore({ code: 'familiar-butterfly-3' }), /^薔薇園の魔女の手下/);
  assert.match(cardLore({ code: 'familiar-legs-3' }), /^委員長の魔女の手下/);
  assert.match(cardLore({ code: 'familiar-nurse-3' }), /^お菓子の魔女の手下/);
  assert.match(cardLore({ code: 'familiar-vine-3' }), /^影の魔女の手下/);
});

test('A/B variants share their witch lore', () => {
  assert.equal(
    cardLore({ code: 'witch-candy_a_10' }),
    cardLore({ code: 'witch-candy_b_10' }),
  );
  assert.equal(
    cardLore({ code: 'witch-mermaid_a_10' }),
    cardLore({ code: 'witch-mermaid_b_10' }),
  );
});
