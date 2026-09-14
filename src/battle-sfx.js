const SOUND_KEYS = Object.freeze({
  DAMAGE: 'damage',
  FAMILIAR_SUMMON: 'familiarSummon',
  SHIELD_BLOCK: 'shieldBlock',
});

export function soundForDuelEvent(event) {
  if (event?.type === 'summon' && event.card?.type === 'familiar') {
    return SOUND_KEYS.FAMILIAR_SUMMON;
  }
  if (event?.type === 'magic' && event.card?.effect === 'nullifyDamage') {
    return SOUND_KEYS.SHIELD_BLOCK;
  }
  if (event?.type === 'damage' && Number(event.amount) > 0) {
    return SOUND_KEYS.DAMAGE;
  }
  return null;
}

export class BattleSfx {
  constructor({ damageSrc, familiarSummonSrc, shieldBlockSrc, AudioCtor = globalThis.Audio }) {
    this.sounds = {
      [SOUND_KEYS.DAMAGE]: new AudioCtor(damageSrc),
      [SOUND_KEYS.FAMILIAR_SUMMON]: new AudioCtor(familiarSummonSrc),
      [SOUND_KEYS.SHIELD_BLOCK]: new AudioCtor(shieldBlockSrc),
    };
    this.pending = null;

    for (const audio of Object.values(this.sounds)) {
      audio.loop = false;
      audio.preload = 'auto';
    }
  }

  _play(sound) {
    const audio = this.sounds[sound];
    audio.pause();
    audio.currentTime = 0;
    this.pending = null;
    try {
      const result = audio.play();
      if (result?.catch) result.catch(() => { this.pending = sound; });
    } catch {
      this.pending = sound;
    }
  }

  handleEvent(event) {
    const sound = soundForDuelEvent(event);
    if (sound) this._play(sound);
  }

  unlock() {
    if (this.pending) this._play(this.pending);
  }
}

function bootstrap() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Audio === 'undefined') return;

  const sfx = new BattleSfx({
    damageSrc: './assets/audio/damage.mp3?v=sfx2',
    familiarSummonSrc: './assets/audio/familiar-summon.mp3?v=sfx2',
    shieldBlockSrc: './assets/audio/shield-block.mp3?v=sfx2',
  });

  window.addEventListener('duel:event', event => sfx.handleEvent(event.detail));
  document.addEventListener('pointerdown', () => sfx.unlock(), { passive: true });
  document.addEventListener('keydown', () => sfx.unlock());
}

bootstrap();
