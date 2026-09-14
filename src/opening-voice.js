export const OPENING_VOICE_SOURCES = Object.freeze({
  madoka: './assets/audio/opening/madoka.mp3?v=opening1',
  mami: './assets/audio/opening/mami.mp3?v=opening1',
});

export function openingVoiceSource(characterId) {
  return OPENING_VOICE_SOURCES[characterId] ?? null;
}

export class OpeningVoice {
  constructor({ sources = OPENING_VOICE_SOURCES, AudioCtor = globalThis.Audio } = {}) {
    this.sounds = Object.fromEntries(Object.entries(sources).map(([characterId, src]) => {
      const audio = new AudioCtor(src);
      audio.loop = false;
      audio.preload = 'auto';
      audio.volume = 1;
      return [characterId, audio];
    }));
    this.played = false;
    this.current = null;
  }

  play(characterId) {
    if (this.played) return false;
    const audio = this.sounds[characterId];
    if (!audio) return false;

    this.played = true;
    this.current = audio;
    audio.pause();
    audio.currentTime = 0;
    try {
      const result = audio.play();
      if (result?.catch) {
        result.catch(() => {
          if (this.current === audio) this.played = false;
        });
      }
    } catch {
      this.played = false;
      return false;
    }
    return true;
  }

  reset() {
    for (const audio of Object.values(this.sounds)) {
      audio.pause();
      audio.currentTime = 0;
    }
    this.played = false;
    this.current = null;
  }
}

function bootstrap() {
  if (typeof document === 'undefined' || typeof Audio === 'undefined') return;

  const openingVoice = new OpeningVoice();

  document.addEventListener('pointerdown', event => {
    const card = event.target.closest?.('#bottom-player .hand button.card');
    const player = document.querySelector('#bottom-player');
    if (!card || !player?.classList.contains('active')) return;
    if (document.querySelector('#turn-name')?.textContent === 'デュエル終了') return;
    openingVoice.play(player.dataset.character);
  }, { capture: true, passive: true });

  document.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (!button) return;
    const gameOver = document.querySelector('#turn-name')?.textContent === 'デュエル終了';
    if (button.id === 'confirm-restart'
      || (button.id === 'new-game' && gameOver)
      || (button.closest('#actions') && button.textContent === 'もう一度対戦')) {
      openingVoice.reset();
    }
  }, true);
}

bootstrap();
