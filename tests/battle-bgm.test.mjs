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

const special = code => ({ type: 'summon', card: { code } });

test('special BGM target is only Walpurgis or Salvation Witch', () => {
  assert.equal(shouldStartSpecialBgm(special('witch-walpurgis_13')), true);
  assert.equal(shouldStartSpecialBgm(special('witch-salvation_13')), true);
  assert.equal(shouldStartSpecialBgm(special('witch-rose_garden_8')), false);
});

test('target summon stops normal BGM but waits for the intro to start special BGM', () => {
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

test('a second target summon restarts special BGM after its intro', () => {
  const bgm = new BattleBgm({ normalSrc: 'normal', specialSrc: 'special', AudioCtor: FakeAudio });
  bgm.startGame();
  bgm.handleEvent(special('witch-walpurgis_13'));
  bgm.startSpecial();
  bgm.special.currentTime = 8;
  bgm.handleEvent(special('witch-salvation_13'));
  assert.equal(bgm.current, null);
  assert.equal(bgm.special.currentTime, 0);
  bgm.startSpecial();
  assert.equal(bgm.special.playCount, 2);
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

test('starting a new game stops special and returns to normal from the beginning', () => {
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
});
