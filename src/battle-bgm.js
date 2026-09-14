const SPECIAL_WITCH_CODES = new Set(['witch-walpurgis_13', 'witch-salvation_13']);

export function shouldStartSpecialBgm(event) {
  return event?.type === 'summon' && SPECIAL_WITCH_CODES.has(event.card?.code);
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

  startGame() {
    this._reset(this.normal);
    this._reset(this.special);
    this._play(this.normal);
  }

  handleEvent(event) {
    if (!shouldStartSpecialBgm(event)) return;

    if (this.current === this.special) {
      if (this.special.paused || this.special.ended) this._restartSpecial();
      return;
    }

    this._reset(this.normal);
    this._reset(this.special);
    this._play(this.special);
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
    normalSrc: './assets/audio/Battle_normal.mp3?v=bgm2',
    specialSrc: './assets/audio/Battle_special.mp4?v=bgm2',
  });

  bgm.startGame();
  window.addEventListener('duel:event', event => bgm.handleEvent(event.detail));
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
