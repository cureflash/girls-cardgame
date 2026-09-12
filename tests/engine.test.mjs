import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine.js';

const zeroRng = () => 0.42;

test('Mami starts with one more card than Madoka', () => {
  const game = new GameEngine({ humanCharacter: 'madoka', aiCharacter: 'mami', rng: zeroRng });
  assert.equal(game.players[1].hand.length, game.players[0].hand.length + 1);
});

test('damage moves ceil(damage/3) cards to hand', () => {
  const game = new GameEngine({ rng: zeroRng });
  const p = game.players[0];
  const handBefore = p.hand.length;
  const graveBefore = p.grave.length;
  game.applyDamage(p, 4);
  assert.equal(p.hand.length - handBefore, 2);
  assert.equal(p.grave.length - graveBefore, 2);
});
