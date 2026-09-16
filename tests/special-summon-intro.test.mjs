import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INTRO_TIMING,
  DOPPEL_VOICE_SOURCES,
  SpecialSummonIntro,
  doppelVoiceSource,
  isSpecialWitchSummon,
  normalizeIntroTiming,
} from '../src/special-summon-intro.js';

const event = (type, code, id = 'player-madoka-1') => ({ type, card: { code, id } });
const root = fileURLToPath(new URL('..', import.meta.url));

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
  assert.equal(doppelVoiceSource('madoka'), 'verified-chunks');
  assert.match(doppelVoiceSource('mami'), /mami\.mp3/);
  for (const id of ['sayaka', 'kyoko', 'homura', 'nagisa']) {
    assert.equal(DOPPEL_VOICE_SOURCES[id], null);
    assert.equal(doppelVoiceSource(id), null);
  }
  assert.equal(existsSync(`${root}/assets/audio/doppel/madoka.mp3`), false);
});

test('intro timing keeps only active controls and clamps supported ranges', () => {
  assert.deepEqual(normalizeIntroTiming({}), DEFAULT_INTRO_TIMING);
  assert.deepEqual(
    normalizeIntroTiming({ disappearPct: 25, invertDurationPct: 35 }),
    DEFAULT_INTRO_TIMING,
  );
  assert.equal(normalizeIntroTiming({ durationMs: 999 }).durationMs, 1500);
  assert.equal(normalizeIntroTiming({ durationMs: 9999 }).durationMs, 6000);
  assert.equal(normalizeIntroTiming({ appearPct: -10 }).appearPct, 0);
  assert.equal(normalizeIntroTiming({ titlePct: 99 }).titlePct, 80);
  assert.equal(normalizeIntroTiming({ invertPct: 99 }).invertPct, 90);
});

test('extreme intro timing never sends decreasing Web Animation offsets', () => {
  const selectors = [
    '.special-intro-enemy',
    '.special-intro-pink',
    '.special-intro-white',
    '.special-intro-title',
    '.special-intro-brush',
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
  intro.negativeLayer = { hidden: true };
  intro.animations = [];
  intro.nameCompleteTimer = null;
  intro.window = { dispatchEvent() {} };
  intro.timing = normalizeIntroTiming({
    durationMs: 1500,
    appearPct: 55,
    titlePct: 80,
    invertPct: 10,
  });

  assert.doesNotThrow(() => intro._animateScene());
  clearTimeout(intro.nameCompleteTimer);
});

test('scene setup failure releases the cutscene lock instead of freezing the duel', () => {
  const dispatched = [];
  const intro = Object.create(SpecialSummonIntro.prototype);
  intro.overlay = { hidden: true };
  intro.negativeLayer = { hidden: true };
  intro.window = { dispatchEvent: value => dispatched.push(value.type) };
  intro.timing = { durationMs: 1500 };
  intro.sceneTimer = null;
  intro.voiceTimer = null;
  intro.nameCompleteTimer = null;
  intro.currentVoice = null;
  intro.animations = [];
  intro.running = true;
  intro.previewing = false;
  intro._animateScene = () => { throw new Error('simulated Safari Web Animations failure'); };
  globalThis.__duelCutsceneActive = true;

  intro._startScene({ startBgm: false, preview: false });

  assert.equal(intro.overlay.hidden, true);
  assert.equal(intro.negativeLayer.hidden, true);
  assert.equal(intro.running, false);
  assert.equal(globalThis.__duelCutsceneActive, false);
  assert.deepEqual(dispatched, ['duel:cutscene-end']);
});

test('obsolete intro controllers and timer monkeypatch are removed', () => {
  const index = readFileSync(`${root}/index.html`, 'utf8');
  const app = readFileSync(`${root}/src/app.js`, 'utf8');
  const intro = readFileSync(`${root}/src/special-summon-intro.js`, 'utf8');

  assert.match(index, /app\.js\?v=homura7/);
  assert.match(index, /special-summon-intro\.js\?v=special-intro7/);
  assert.doesNotMatch(index, /special-intro-screen\.js/);
  assert.doesNotMatch(index, /special-intro-sequence\.js/);
  assert.doesNotMatch(index, /madoka-doppel-voice\.js/);
  assert.equal(existsSync(`${root}/src/special-intro-screen.js`), false);
  assert.equal(existsSync(`${root}/src/special-intro-sequence.js`), false);
  assert.equal(existsSync(`${root}/src/madoka-doppel-voice.js`), false);

  assert.match(app, /globalThis\.__duelCutsceneActive/);
  assert.match(app, /addEventListener\('duel:cutscene-end', scheduleAI\)/);
  assert.doesNotMatch(intro, /installCutsceneTimerGate/);
  assert.doesNotMatch(intro, /windowRef\.setTimeout/);
  assert.doesNotMatch(intro, /windowRef\.clearTimeout/);
});
