const SPECIAL_WITCH_CODES = new Set(['witch-walpurgis_13', 'witch-salvation_13']);

export function shouldStartSpecialBgm(event) {
  return ['summon', 'revive'].includes(event?.type)
    && SPECIAL_WITCH_CODES.has(event.card?.code);
}

export class BattleBgm {
  constructor({ normalSrc, specialSrc, AudioCtor = globalThis.Audio }) {
    this.normal = new AudioCtor(normalSrc);
    this.special = new AudioCtor(specialSrc);
    this.normal.loop = false;
    this.special.loop = true;
    this.normal.preload = 'auto';
    this.special.preload = 'auto';
    this.current = null;
    this.blocked = false;

    this.special.addEventListener?.('ended', () => {
      if (this.current === this.special) this._restartSpecial();
    });
  }

  _reset(audio) {
    audio.pause();
    audio.currentTime = 0;
  }

  _play(audio) {
    this.current = audio;
    this.blocked = false;
    try {
      const result = audio.play();
      if (result?.catch) {
        result.catch(() => {
          if (this.current === audio && audio.paused) this.blocked = true;
        });
      }
    } catch {
      this.blocked = true;
    }
  }

  _restartSpecial() {
    this.special.pause();
    this.special.currentTime = 0;
    this._play(this.special);
  }

  stop() {
    this._reset(this.normal);
    this._reset(this.special);
    this.current = null;
    this.blocked = false;
  }

  startGame() {
    this._reset(this.normal);
    this._reset(this.special);
    this._play(this.normal);
  }

  prepareSpecial() {
    this._reset(this.normal);
    this._reset(this.special);
    this.current = null;
    this.blocked = false;
  }

  startSpecial() {
    this._reset(this.normal);
    this._reset(this.special);
    this._play(this.special);
  }

  handleEvent(event) {
    if (event?.type === 'gameOver') {
      this.stop();
      return;
    }
    if (shouldStartSpecialBgm(event)) this.prepareSpecial();
  }

  unlock() {
    if (!this.current?.paused) return;
    if (this.current.ended) this.current.currentTime = 0;
    this._play(this.current);
  }
}

function bootstrap() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Audio === 'undefined') return;

  const bgm = new BattleBgm({
    normalSrc: './assets/audio/Battle_normal.mp3?v=bgm5',
    specialSrc: './assets/audio/Battle_special.mp4?v=bgm5',
  });

  // "playing" fires only when the normal BGM has actually started/resumed.
  // Opening voice uses this as its zero point and plays one second later.
  bgm.normal.addEventListener?.('playing', () => {
    window.dispatchEvent(new CustomEvent('duel:normal-bgm-started'));
  });

  bgm.startGame();
  window.addEventListener('duel:event', event => bgm.handleEvent(event.detail));
  window.addEventListener('duel:special-bgm', () => bgm.startSpecial());
  document.addEventListener('pointerdown', () => bgm.unlock(), { passive: true });
  document.addEventListener('keydown', () => bgm.unlock());
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (!button) return;
    const gameOver = document.querySelector('#turn-name')?.textContent === 'デュエル終了';
    if (button.id === 'confirm-restart'
      || (button.id === 'new-game' && gameOver)
      || (button.closest('#actions') && button.textContent === 'もう一度対戦')) {
      bgm.startGame();
    }
  }, true);
}

bootstrap();
