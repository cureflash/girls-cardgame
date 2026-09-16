import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INTRO_TIMING,
  DOPPEL_VOICE_SOURCES,
  SpecialSummonIntro,
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

test('extreme intro timing never sends decreasing Web Animation offsets', () => {
  const selectors = [
    '.special-intro-enemy',
    '.special-intro-pink',
    '.special-intro-white',
    '.special-intro-title',
    '.special-intro-brush',
    '.special-intro-negative',
  ];
  const elements = Object.fromEntries(selectors.map(selector => [selector, {
    animate(keyframes) {
      let previous = -Infinity;
      for (const frame of keyframes) {
        assert.ok(frame.offset >= previous, `${selector} offset moved backwards`);
        previous = frame.offset;
      }
      return { cancel() {} };
    },
  }]));

  const intro = Object.create(SpecialSummonIntro.prototype);
  intro.overlay = { querySelector: selector => elements[selector] };
  intro.animations = [];
  intro.timing = normalizeIntroTiming({
    durationMs: 1500,
    appearPct: 55,
    disappearPct: 25,
    titlePct: 80,
    invertPct: 10,
    invertDurationPct: 35,
  });

  assert.doesNotThrow(() => intro._animateScene());
});

test('scene setup failure releases the cutscene lock instead of freezing the duel', () => {
  const dispatched = [];
  const intro = Object.create(SpecialSummonIntro.prototype);
  intro.overlay = { hidden: true };
  intro.window = { dispatchEvent: value => dispatched.push(value.type) };
  intro.timing = { durationMs: 1500 };
  intro.sceneTimer = null;
  intro.voiceTimer = null;
  intro.currentVoice = null;
  intro.animations = [];
  intro.running = true;
  intro.previewing = false;
  intro._animateScene = () => { throw new Error('simulated Safari Web Animations failure'); };
  globalThis.__duelCutsceneActive = true;

  intro._startScene({ startBgm: false, preview: false });

  assert.equal(intro.overlay.hidden, true);
  assert.equal(intro.running, false);
  assert.equal(globalThis.__duelCutsceneActive, false);
  assert.deepEqual(dispatched, ['duel:cutscene-end']);
});
