import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_VOICE_SOURCES, OpeningVoice, openingVoiceSource } from '../src/opening-voice.js';

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.loop = false;
    this.preload = '';
    this.volume = 0;
    this.currentTime = 0;
    this.paused = true;
    this.playCount = 0;
  }
  play() { this.paused = false; this.playCount++; return Promise.resolve(); }
  pause() { this.paused = true; }
}

test('Madoka and Mami opening voices are registered and other characters remain opt-in', () => {
  assert.equal(openingVoiceSource('madoka'), OPENING_VOICE_SOURCES.madoka);
  assert.equal(openingVoiceSource('mami'), OPENING_VOICE_SOURCES.mami);
  assert.equal(openingVoiceSource('sayaka'), null);
});

test('opening voice plays only once until the duel is reset', () => {
  const voice = new OpeningVoice({ AudioCtor: FakeAudio });
  assert.equal(voice.play('madoka'), true);
  assert.equal(voice.play('madoka'), false);
  assert.equal(voice.play('mami'), false);
  assert.equal(voice.sounds.madoka.playCount, 1);
  assert.equal(voice.sounds.mami.playCount, 0);

  voice.reset();
  assert.equal(voice.play('mami'), true);
  assert.equal(voice.sounds.mami.playCount, 1);
});

test('an unregistered character does not consume the one-shot opening voice', () => {
  const voice = new OpeningVoice({ AudioCtor: FakeAudio });
  assert.equal(voice.play('sayaka'), false);
  assert.equal(voice.play('madoka'), true);
  assert.equal(voice.sounds.madoka.playCount, 1);
});
