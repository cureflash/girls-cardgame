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
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Audio === 'undefined') return;

  const openingVoice = new OpeningVoice();
  let startTimer = null;

  const cancelPending = () => {
    if (startTimer !== null) clearTimeout(startTimer);
    startTimer = null;
  };

  const scheduleAfterBgm = () => {
    cancelPending();
    startTimer = setTimeout(() => {
      startTimer = null;
      if (document.querySelector('#turn-name')?.textContent === 'デュエル終了') return;
      const player = document.querySelector('#bottom-player');
      openingVoice.play(player?.dataset?.character);
    }, 1000);
  };

  // Start voice one second after the normal battle BGM has actually begun playing.
  window.addEventListener('duel:normal-bgm-started', scheduleAfterBgm);

  // Battle BGM emits this synchronously before restarting, so an earlier game's
  // pending/opening voice cannot cancel the new game's BGM-start schedule later.
  window.addEventListener('duel:audio-restart', () => {
    cancelPending();
    openingVoice.reset();
  });
}

bootstrap();
