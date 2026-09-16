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
    this.ended = false;
    this.playCount = 0;
    this.listeners = new Map();
  }
  play() { this.paused = false; this.ended = false; this.playCount++; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { this.listeners.get(type)?.(); }
}

class RejectOnceAudio extends FakeAudio {
  constructor(src) {
    super(src);
    this.rejectNext = true;
  }
  play() {
    this.playCount++;
    this.ended = false;
    if (this.rejectNext) {
      this.rejectNext = false;
      this.paused = true;
      return Promise.reject(new Error('autoplay blocked'));
    }
    this.paused = false;
    return Promise.resolve();
  }
}

const special = (code, type = 'summon') => ({ type, card: { code } });

test('special BGM target is Walpurgis or Salvation Witch on summon or revive', () => {
  assert.equal(shouldStartSpecialBgm(special('witch-walpurgis_13')), true);
  assert.equal(shouldStartSpecialBgm(special('witch-salvation_13')), true);
  assert.equal(shouldStartSpecialBgm(special('witch-walpurgis_13', 'revive')), true);
  assert.equal(shouldStartSpecialBgm(special('witch-salvation_13', 'revive')), true);
  assert.equal(shouldStartSpecialBgm(special('witch-rose_garden_8')), false);
});

test('first target appearance stops normal BGM but waits for the intro to start special BGM', () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: FakeAudio });
  bgm.startGame();
  bgm.handleEvent(special('witch-walpurgis_13'));
  assert.equal(bgm.current, null);
  assert.equal(bgm.normal.paused, true);
  assert.equal(bgm.special.playCount, 0);
  bgm.startSpecial();
  assert.equal(bgm.current, bgm.special);
  assert.equal(bgm.special.loop, true);
  assert.equal(bgm.special.playCount, 1);
});

test('first revived target also stops normal BGM before its intro', () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: FakeAudio });
  bgm.startGame();
  bgm.handleEvent(special('witch-salvation_13', 'revive'));
  assert.equal(bgm.current, null);
  assert.equal(bgm.normal.paused, true);
  assert.equal(bgm.special.playCount, 0);
});

test('later target summons do not pause, rewind, or restart special BGM', () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: FakeAudio });
  bgm.startGame();
  bgm.handleEvent(special('witch-walpurgis_13'));
  bgm.startSpecial();
  bgm.special.currentTime = 8;

  bgm.handleEvent(special('witch-salvation_13'));
  assert.equal(bgm.current, bgm.special);
  assert.equal(bgm.special.currentTime, 8);
  assert.equal(bgm.special.paused, false);

  bgm.startSpecial();
  assert.equal(bgm.special.currentTime, 8);
  assert.equal(bgm.special.playCount, 1);
  assert.equal(bgm.special.paused, false);
});

test('special explicitly restarts at media end even if native looping fails', () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: FakeAudio });
  bgm.startGame();
  bgm.handleEvent(special('witch-salvation_13'));
  bgm.startSpecial();
  bgm.special.ended = true;
  bgm.special.paused = true;
  bgm.special.currentTime = 12;
  bgm.special.dispatch('ended');
  assert.equal(bgm.special.currentTime, 0);
  assert.equal(bgm.special.playCount, 2);
  assert.equal(bgm.special.paused, false);
});

test('game over stops all BGM', () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: FakeAudio });
  bgm.startGame();
  bgm.handleEvent(special('witch-walpurgis_13'));
  bgm.startSpecial();
  bgm.handleEvent({ type: 'gameOver', winner: 0 });
  assert.equal(bgm.current, null);
  assert.equal(bgm.normal.paused, true);
  assert.equal(bgm.special.paused, true);
  assert.equal(bgm.normal.currentTime, 0);
  assert.equal(bgm.special.currentTime, 0);
});

test('starting a new game stops special and allows a fresh first transition', () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: FakeAudio });
  bgm.startGame();
  bgm.handleEvent(special('witch-salvation_13'));
  bgm.startSpecial();
  bgm.normal.currentTime = 42;
  bgm.special.currentTime = 17;
  bgm.startGame();
  assert.equal(bgm.current, bgm.normal);
  assert.equal(bgm.normal.currentTime, 0);
  assert.equal(bgm.special.currentTime, 0);
  assert.equal(bgm.special.paused, true);
  assert.equal(bgm.normal.playCount, 2);
  assert.equal(bgm.specialStarted, false);

  bgm.handleEvent(special('witch-walpurgis_13'));
  bgm.startSpecial();
  assert.equal(bgm.special.playCount, 2);
  assert.equal(bgm.specialStarted, true);
});

test('a rejected normal BGM start can be retried by the same restart interaction', async () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: RejectOnceAudio });
  bgm.startGame();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(bgm.current, bgm.normal);
  assert.equal(bgm.normal.paused, true);
  assert.equal(bgm.blocked, true);

  bgm.unlock();
  assert.equal(bgm.normal.playCount, 2);
  assert.equal(bgm.normal.paused, false);
  assert.equal(bgm.blocked, false);
});
