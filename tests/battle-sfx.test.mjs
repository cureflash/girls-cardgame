import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleSfx, soundForDuelEvent, viewerResult } from '../src/battle-sfx.js';

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.loop = true;
    this.preload = '';
    this.volume = 0;
    this.currentTime = 12;
    this.paused = false;
    this.playCount = 0;
    this.pauseCount = 0;
    this.rejectNext = false;
  }
  play() {
    this.paused = false;
    this.playCount++;
    if (this.rejectNext) { this.rejectNext = false; return Promise.reject(new Error('blocked')); }
    return Promise.resolve();
  }
  pause() { this.paused = true; this.pauseCount++; }
}

const makeSfx = () => new BattleSfx({
  damageSrc: 'damage', familiarSummonSrc: 'summon', shieldBlockSrc: 'shield', defeatSrc: 'defeat', AudioCtor: FakeAudio,
});

test('duel events map to the intended sound effects', () => {
  assert.equal(soundForDuelEvent({ type: 'summon', card: { type: 'familiar' } }), 'familiarSummon');
  assert.equal(soundForDuelEvent({ type: 'magic', card: { effect: 'nullifyDamage' } }), 'shieldBlock');
  assert.equal(soundForDuelEvent({ type: 'damage', amount: 3 }), 'damage');
});

test('witch summons and prevented damage do not play the wrong sound', () => {
  assert.equal(soundForDuelEvent({ type: 'summon', card: { type: 'witch' } }), null);
  assert.equal(soundForDuelEvent({ type: 'damage', amount: 0, rawAmount: 5 }), null);
  assert.equal(soundForDuelEvent({ type: 'magic', card: { effect: 'boost' } }), null);
});

test('each effect is non-looping, full volume and restarts from the beginning', () => {
  const sfx = makeSfx();
  for (const audio of Object.values(sfx.sounds)) {
    assert.equal(audio.loop, false);
    assert.equal(audio.preload, 'auto');
    assert.equal(audio.volume, 1);
  }
  sfx.handleEvent({ type: 'damage', amount: 2 });
  assert.equal(sfx.sounds.damage.currentTime, 0);
  assert.equal(sfx.sounds.damage.playCount, 1);
  sfx.sounds.damage.currentTime = 0.5;
  sfx.handleEvent({ type: 'damage', amount: 1 });
  assert.equal(sfx.sounds.damage.currentTime, 0);
  assert.equal(sfx.sounds.damage.playCount, 2);
});

test('blocked SFX is retried on the next user interaction', async () => {
  const sfx = makeSfx();
  sfx.sounds.familiarSummon.rejectNext = true;
  sfx.handleEvent({ type: 'summon', card: { type: 'familiar' } });
  await Promise.resolve();
  assert.equal(sfx.pending, 'familiarSummon');
  sfx.unlock();
  assert.equal(sfx.pending, null);
  assert.equal(sfx.sounds.familiarSummon.playCount, 2);
});

test('viewer result is based on CPU seat and winner index', () => {
  assert.equal(viewerResult({ type: 'gameOver', winner: 0 }, 'cpu', 'first'), 'victory');
  assert.equal(viewerResult({ type: 'gameOver', winner: 1 }, 'cpu', 'first'), 'defeat');
  assert.equal(viewerResult({ type: 'gameOver', winner: 1 }, 'cpu', 'second'), 'victory');
  assert.equal(viewerResult({ type: 'gameOver', winner: 0 }, 'cpu', 'second'), 'defeat');
  assert.equal(viewerResult({ type: 'gameOver', winner: 0 }, 'local', 'first'), null);
});

test('defeat plays the single defeat sound', () => {
  const sfx = makeSfx();
  sfx.playDefeat();
  assert.equal(sfx.sounds.defeat.currentTime, 0);
  assert.equal(sfx.sounds.defeat.playCount, 1);
});
