import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INTRO_TIMING,
  DOPPEL_VOICE_SOURCES,
  doppelVoiceSource,
  isSpecialWitchSummon,
  normalizeIntroTiming,
} from '../src/special-summon-intro.js';

const event = (type, code, id = 'player-madoka-1') => ({ type, card: { code, id } });

test('special summon intro targets Walpurgis and Salvation Witch on summon or revive', () => {
  assert.equal(isSpecialWitchSummon(event('summon', 'witch-walpurgis_13')), true);
  assert.equal(isSpecialWitchSummon(event('summon', 'witch-salvation_13')), true);
  assert.equal(isSpecialWitchSummon(event('revive', 'witch-walpurgis_13')), true);
  assert.equal(isSpecialWitchSummon(event('revive', 'witch-salvation_13')), true);
  assert.equal(isSpecialWitchSummon(event('summon', 'witch-candy_a_10')), false);
  assert.equal(isSpecialWitchSummon(event('revive', 'witch-candy_a_10')), false);
  assert.equal(isSpecialWitchSummon({ type: 'attack' }), false);
});

test('Doppel voices currently exist for Madoka and Mami only', () => {
  assert.match(doppelVoiceSource('madoka'), /madoka\.mp3/);
  assert.match(doppelVoiceSource('mami'), /mami\.mp3/);
  for (const id of ['sayaka', 'kyoko', 'homura', 'nagisa']) {
    assert.equal(DOPPEL_VOICE_SOURCES[id], null);
    assert.equal(doppelVoiceSource(id), null);
  }
});

test('intro timing sliders are clamped to supported ranges', () => {
  assert.deepEqual(normalizeIntroTiming({}), DEFAULT_INTRO_TIMING);
  assert.equal(normalizeIntroTiming({ durationMs: 999 }).durationMs, 1500);
  assert.equal(normalizeIntroTiming({ durationMs: 9999 }).durationMs, 6000);
  assert.equal(normalizeIntroTiming({ appearPct: -10 }).appearPct, 0);
  assert.equal(normalizeIntroTiming({ titlePct: 99 }).titlePct, 80);
  assert.equal(normalizeIntroTiming({ invertPct: 99 }).invertPct, 90);
  assert.equal(normalizeIntroTiming({ invertDurationPct: 1 }).invertDurationPct, 3);
});
