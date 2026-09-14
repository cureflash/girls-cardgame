import { DAMAGE_SRC } from './damage.js';
import { FAMILIAR_SUMMON_SRC } from './familiar-summon.js';
import { SHIELD_BLOCK_SRC } from './shield-block.js';
import { DEFEAT_PIANO_SRC } from './defeat-piano.js';

const SOUND_KEYS = Object.freeze({
  DAMAGE: 'damage',
  FAMILIAR_SUMMON: 'familiarSummon',
  SHIELD_BLOCK: 'shieldBlock',
  DEFEAT: 'defeat',
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

export function viewerResult(event, modeValue, seatValue) {
  if (event?.type !== 'gameOver' || modeValue !== 'cpu') return null;
  const human = seatValue === 'second' ? 1 : 0;
  return event.winner === human ? 'victory' : 'defeat';
}

export class BattleSfx {
  constructor({
    damageSrc = DAMAGE_SRC,
    familiarSummonSrc = FAMILIAR_SUMMON_SRC,
    shieldBlockSrc = SHIELD_BLOCK_SRC,
    defeatSrc = DEFEAT_PIANO_SRC,
    AudioCtor = globalThis.Audio,
  } = {}) {
    this.sounds = {
      [SOUND_KEYS.DAMAGE]: new AudioCtor(damageSrc),
      [SOUND_KEYS.FAMILIAR_SUMMON]: new AudioCtor(familiarSummonSrc),
      [SOUND_KEYS.SHIELD_BLOCK]: new AudioCtor(shieldBlockSrc),
      [SOUND_KEYS.DEFEAT]: new AudioCtor(defeatSrc),
    };
    this.pending = null;

    for (const audio of Object.values(this.sounds)) {
      audio.loop = false;
      audio.preload = 'auto';
      audio.volume = 1;
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

  playDefeat() {
    this._play(SOUND_KEYS.DEFEAT);
  }

  unlock() {
    if (this.pending) this._play(this.pending);
  }
}

export function showVictoryTitle(documentObj = globalThis.document) {
  const layer = documentObj?.querySelector?.('#effect-layer');
  if (!layer) return null;

  const title = documentObj.createElement('div');
  title.textContent = 'VICTORY';
  title.setAttribute('role', 'status');
  Object.assign(title.style, {
    position: 'absolute',
    inset: '0',
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(10, 10, 18, .55)',
    color: '#fff4cf',
    fontFamily: 'serif',
    fontSize: 'clamp(52px, 12vw, 132px)',
    fontWeight: '700',
    letterSpacing: '.16em',
    textIndent: '.16em',
    textShadow: '0 0 18px rgba(230, 200, 134, .75), 0 4px 24px #000',
  });
  layer.replaceChildren(title);

  const animation = title.animate?.([
    { opacity: 0, transform: 'scale(.92)' },
    { opacity: 1, transform: 'scale(1)', offset: .18 },
    { opacity: 1, transform: 'scale(1)', offset: .78 },
    { opacity: 0, transform: 'scale(1.03)' },
  ], { duration: 2200, easing: 'ease-out', fill: 'forwards' });

  if (animation?.finished) animation.finished.finally(() => title.remove());
  else setTimeout(() => title.remove(), 2200);
  return title;
}

function bootstrap() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Audio === 'undefined') return;

  const sfx = new BattleSfx();

  window.addEventListener('duel:event', event => {
    const detail = event.detail;
    sfx.handleEvent(detail);
    const result = viewerResult(detail, document.querySelector('#mode')?.value, document.querySelector('#seat')?.value);
    if (result === 'victory') showVictoryTitle(document);
    else if (result === 'defeat') sfx.playDefeat();
  });
  document.addEventListener('pointerdown', () => sfx.unlock(), { passive: true });
  document.addEventListener('keydown', () => sfx.unlock());
}

bootstrap();
