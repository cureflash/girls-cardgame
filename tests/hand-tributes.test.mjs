import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, CARD_TYPES } from '../src/game-engine.js';

const familiar = (id, atk) => ({ id, name: id, type: CARD_TYPES.FAMILIAR, attack: atk });
const witch = (id, atk) => ({ id, name: id, type: CARD_TYPES.WITCH, attack: atk, tributeThreshold: atk });
const chars = {
  madoka: { id: 'madoka', name: '鹿目まどか' },
  mami: { id: 'mami', name: '巴マミ' },
};

function engine() {
  return new GameEngine({
    players: [
      { id: 'a', name: 'A', character: chars.madoka },
      { id: 'b', name: 'B', character: chars.mami },
    ],
    decks: [
      Array.from({ length: 20 }, (_, i) => familiar(`a${i}`, 3)),
      Array.from({ length: 20 }, (_, i) => familiar(`b${i}`, 3)),
    ],
    openingHand: 0,
    rng: () => 0.999999,
  });
}

test('hand familiars can be tributed to summon a witch', () => {
  const e = engine(), p = e.player(0);
  p.hand = [witch('w8', 8), familiar('h3', 3), familiar('h5', 5)];
  assert.equal(e.canSummon(0, 'w8'), true);
  e.summon(0, 'w8', [{ zone: 'hand', id: 'h3' }, { zone: 'hand', id: 'h5' }]);
  assert.equal(p.field[0].id, 'w8');
  assert.deepEqual(p.graveyard.map(c => c.id).sort(), ['h3', 'h5']);
  assert.equal(p.hand.length, 0);
});

test('field monsters and hand familiars can be mixed as tributes', () => {
  const e = engine(), p = e.player(0);
  p.hand = [witch('w13', 13), familiar('h5', 5)];
  p.field[0] = witch('field8', 8);
  e.summon(0, 'w13', [{ zone: 'field', slot: 0 }, { zone: 'hand', id: 'h5' }]);
  assert.equal(p.field[0].id, 'w13');
  assert.deepEqual(p.graveyard.map(c => c.id).sort(), ['field8', 'h5']);
});

test('a witch in hand is not eligible as a hand tribute', () => {
  const e = engine(), p = e.player(0);
  p.hand = [witch('target8', 8), witch('hand10', 10), familiar('h5', 5)];
  assert.equal(e.canSummon(0, 'target8'), false);
  p.hand.push(familiar('h3', 3));
  assert.equal(e.canSummon(0, 'target8'), true);
  const before = e.snapshot();
  assert.throws(() => e.summon(0, 'target8', [{ zone: 'hand', id: 'hand10' }]));
  assert.deepEqual(e.snapshot(), before);
});

test('a full field requires at least one field tribute even if hand familiars meet the threshold', () => {
  const e = engine(), p = e.player(0);
  p.hand = [witch('w8', 8), familiar('h3', 3), familiar('h5', 5)];
  p.field = [familiar('f3', 3), familiar('f4', 4), familiar('f5', 5), familiar('f3b', 3), familiar('f4b', 4)];
  const before = e.snapshot();
  assert.throws(() => e.summon(0, 'w8', [{ zone: 'hand', id: 'h3' }, { zone: 'hand', id: 'h5' }]));
  assert.deepEqual(e.snapshot(), before);
  e.summon(0, 'w8', [{ zone: 'field', slot: 0 }, { zone: 'hand', id: 'h5' }]);
  assert.equal(p.field.some(c => c?.id === 'w8'), true);
});

test('legacy field-slot tribute calls auto-supplement from hand familiars for AI compatibility', () => {
  const e = engine(), p = e.player(0);
  p.hand = [witch('w8', 8), familiar('h5', 5)];
  p.field[0] = familiar('f3', 3);
  const plan = e.validTributeSets(0, p.hand[0]).find(x => x.slots.length === 1 && x.slots[0] === 0);
  assert.deepEqual(plan.handIds, ['h5']);
  e.summon(0, 'w8', [0]);
  assert.equal(p.field[0].id, 'w8');
  assert.deepEqual(p.graveyard.map(c => c.id).sort(), ['f3', 'h5']);
});