import test from 'node:test';
import assert from 'node:assert/strict';
import { DOPPEL_VOICE_SOURCES, doppelVoiceSource, isSpecialWitchSummon } from '../src/special-summon-intro.js';

const summon = code => ({ type: 'summon', card: { code } });

test('special summon intro targets Walpurgis and Salvation Witch only', () => {
  assert.equal(isSpecialWitchSummon(summon('witch-walpurgis_13')), true);
  assert.equal(isSpecialWitchSummon(summon('witch-salvation_13')), true);
  assert.equal(isSpecialWitchSummon(summon('witch-candy_a_10')), false);
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
