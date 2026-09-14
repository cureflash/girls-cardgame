import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleBgm, shouldStartSpecialBgm } from '../src/battle-bgm.js';

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.loop = false;
    this.preload = '';
    this.currentTime = 0;
    this.paused = true;
    this.playCount = 0;
  }

  play() {
    this.paused = false;
    this.playCount++;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

const special = code => ({ type: 'summon', card: { code } });

test('special BGM is triggered only by summoning Walpurgis or Salvation Witch', () => {
  assert.equal(shouldStartSpecialBgm(special('witch-walpurgis_13')), true);
  assert.equal(shouldStartSpecialBgm(special('witch-salvation_13')), true);
  assert.equal(shouldStartSpecialBgm(special('witch-rose_garden_8')), false);
  assert.equal(shouldStartSpecialBgm({ type: 'revive', card: { code: 'witch-salvation_13' } }), false);
});

test('normal plays once per game and special loops after a target summon', () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: FakeAudio });
  assert.equal(bgm.normal.loop, false);
  assert.equal(bgm.special.loop, true);

  bgm.startGame();
  assert.equal(bgm.current, bgm.normal);
  assert.equal(bgm.normal.playCount, 1);
  assert.equal(bgm.special.playCount, 0);

  bgm.handleEvent(special('witch-walpurgis_13'));
  assert.equal(bgm.current, bgm.special);
  assert.equal(bgm.normal.paused, true);
  assert.equal(bgm.special.playCount, 1);

  bgm.handleEvent(special('witch-salvation_13'));
  assert.equal(bgm.special.playCount, 1);
});

test('starting a new game stops special and returns to normal from the beginning', () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: FakeAudio });
  bgm.startGame();
  bgm.handleEvent(special('witch-salvation_13'));
  bgm.normal.currentTime = 42;
  bgm.special.currentTime = 17;

  bgm.startGame();
  assert.equal(bgm.current, bgm.normal);
  assert.equal(bgm.normal.currentTime, 0);
  assert.equal(bgm.special.currentTime, 0);
  assert.equal(bgm.special.paused, true);
  assert.equal(bgm.normal.playCount, 2);
});
