const SPECIAL_WITCH_CODES = new Set(['witch-walpurgis_13', 'witch-salvation_13']);
const CHARACTER_IDS = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura', 'nagisa'];
const TIMING_STORAGE_KEY = 'walpurgisIntroTimingV1';

const WALPURGIS_IMAGE_SRC = './assets/special-intro/walpurgis.webp?v=special-intro3';
const WALPURGIS_RUNES_SRC = './assets/special-intro/walpurgis-runes.png?v=special-intro3';

export const DOPPEL_VOICE_SOURCES = Object.freeze({
  madoka: './assets/audio/doppel/madoka.mp3?v=doppel3',
  mami: './assets/audio/doppel/mami.mp3?v=doppel3',
  sayaka: null,
  kyoko: null,
  homura: null,
  nagisa: null,
});

export const DEFAULT_INTRO_TIMING = Object.freeze({
  durationMs: 3600,
  appearPct: 12,
  titlePct: 34,
  invertPct: 51,
  invertDurationPct: 9,
});

export function normalizeIntroTiming(value = {}) {
  const number = (key, fallback) => Number.isFinite(Number(value[key])) ? Number(value[key]) : fallback;
  return {
    durationMs: Math.min(6000, Math.max(1500, number('durationMs', DEFAULT_INTRO_TIMING.durationMs))),
    appearPct: Math.min(55, Math.max(0, number('appearPct', DEFAULT_INTRO_TIMING.appearPct))),
    titlePct: Math.min(80, Math.max(5, number('titlePct', DEFAULT_INTRO_TIMING.titlePct))),
    invertPct: Math.min(90, Math.max(10, number('invertPct', DEFAULT_INTRO_TIMING.invertPct))),
    invertDurationPct: Math.min(35, Math.max(3, number('invertDurationPct', DEFAULT_INTRO_TIMING.invertDurationPct))),
  };
}

export function isSpecialWitchSummon(event) {
  return ['summon', 'revive'].includes(event?.type)
    && SPECIAL_WITCH_CODES.has(event.card?.code);
}

export function doppelVoiceSource(characterId) {
  return DOPPEL_VOICE_SOURCES[characterId] ?? null;
}

const NATIVE_SET_TIMEOUT = globalThis.setTimeout?.bind(globalThis);
const NATIVE_CLEAR_TIMEOUT = globalThis.clearTimeout?.bind(globalThis);

export function installCutsceneTimerGate(windowRef = globalThis.window) {
  if (!windowRef || windowRef.__duelCutsceneTimerGateInstalled) return;
  windowRef.__duelCutsceneTimerGateInstalled = true;
  const deferred = new Map();
  let nextToken = -1;

  windowRef.setTimeout = (callback, delay = 0, ...args) => {
    if (globalThis.__duelCutsceneActive && Number(delay) === 450) {
      const token = nextToken--;
      const resume = () => {
        if (!deferred.has(token)) return;
        deferred.delete(token);
        NATIVE_SET_TIMEOUT(callback, 0, ...args);
      };
      deferred.set(token, resume);
      windowRef.addEventListener('duel:cutscene-end', resume, { once: true });
      return token;
    }
    return NATIVE_SET_TIMEOUT(callback, delay, ...args);
  };

  windowRef.clearTimeout = token => {
    const resume = deferred.get(token);
    if (resume) {
      windowRef.removeEventListener('duel:cutscene-end', resume);
      deferred.delete(token);
      return;
    }
    NATIVE_CLEAR_TIMEOUT(token);
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function pct(value) {
  return clamp01(Number(value) / 100);
}

function nextFrame(element) {
  void element?.offsetWidth;
}

export class SpecialSummonIntro {
  constructor({
    documentRef = globalThis.document,
    windowRef = globalThis.window,
    AudioCtor = globalThis.Audio,
    storage = globalThis.localStorage,
  } = {}) {
    this.document = documentRef;
    this.window = windowRef;
    this.AudioCtor = AudioCtor;
    this.storage = storage;
    this.timing = this._loadTiming();
    this.running = false;
    this.previewing = false;
    this.sceneTimer = null;
    this.voiceTimer = null;
    this.currentVoice = null;
    this.animations = [];
    this.voices = Object.fromEntries(
      Object.entries(DOPPEL_VOICE_SOURCES)
        .filter(([, src]) => !!src)
        .map(([characterId, src]) => {
          const audio = new AudioCtor(src);
          audio.loop = false;
          audio.preload = 'auto';
          audio.volume = 1;
          return [characterId, audio];
        }),
    );
    this.overlay = this._createOverlay();
    this._installControls();
  }

  _loadTiming() {
    try {
      const raw = this.storage?.getItem?.(TIMING_STORAGE_KEY);
      return normalizeIntroTiming(raw ? JSON.parse(raw) : DEFAULT_INTRO_TIMING);
    } catch {
      return normalizeIntroTiming(DEFAULT_INTRO_TIMING);
    }
  }

  _saveTiming() {
    try {
      this.storage?.setItem?.(TIMING_STORAGE_KEY, JSON.stringify(this.timing));
    } catch {
      // localStorage can be unavailable in private/file contexts. Timing still works for this session.
    }
  }

  _createOverlay() {
    const existing = this.document?.querySelector?.('#special-summon-intro');
    if (existing) return existing;
    if (!this.document?.body) return null;

    const style = this.document.createElement('style');
    style.id = 'special-summon-intro-style';
    style.textContent = `
#special-summon-intro[hidden]{display:none!important}
#special-summon-intro{position:fixed;inset:0;z-index:10000;overflow:hidden;background:transparent;pointer-events:auto}
.special-intro-enemy{position:absolute;z-index:2;left:27%;top:50%;width:min(40vw,520px);max-height:82vh;object-fit:contain;transform:translate(-50%,-50%) scale(.78) rotate(-2deg);opacity:0;filter:drop-shadow(0 18px 28px rgba(0,0,0,.82));display:block}
.special-intro-pink,.special-intro-white,.special-intro-negative,.special-intro-title{position:absolute;inset:0;pointer-events:none}
.special-intro-pink{z-index:1;background:radial-gradient(circle at 35% 45%,rgba(255,255,255,.96),rgba(255,90,180,.72) 18%,rgba(185,40,210,.34) 38%,transparent 62%);opacity:0;mix-blend-mode:screen}
.special-intro-white{z-index:4;background:#fff;opacity:0;mix-blend-mode:screen}
.special-intro-negative{z-index:5;background:#fff;opacity:0;mix-blend-mode:difference}
.special-intro-title{z-index:3;display:flex;align-items:center;justify-content:flex-end;padding-right:6vw;box-sizing:border-box;opacity:0}
.special-intro-brush{position:relative;width:min(62vw,920px);height:210px;display:flex;align-items:center;justify-content:center;transform:translateX(16vw)}
.special-intro-brush::before{content:"";position:absolute;inset:0;background:#080607;clip-path:polygon(2% 18%,8% 10%,15% 18%,24% 5%,31% 14%,40% 6%,48% 15%,56% 2%,64% 14%,73% 8%,83% 17%,96% 11%,92% 32%,99% 41%,93% 50%,98% 62%,89% 68%,96% 85%,82% 82%,73% 92%,62% 83%,51% 96%,40% 85%,30% 94%,21% 82%,10% 90%,15% 70%,4% 63%,11% 51%,3% 41%,10% 31%);filter:drop-shadow(0 0 7px rgba(0,0,0,.9))}
.special-intro-brush::after{content:"";position:absolute;inset:18px 30px;background:linear-gradient(90deg,transparent 0 5%,rgba(255,255,255,.08) 5% 7%,transparent 8% 24%,rgba(255,255,255,.07) 25% 28%,transparent 29% 100%);opacity:.8}
.special-intro-runes{position:relative;z-index:2;width:min(48vw,620px);max-width:100%;max-height:105px;object-fit:contain;display:block;filter:brightness(0) invert(1) drop-shadow(0 0 9px rgba(255,255,255,.28))}
.special-intro-tuner{display:inline-flex;align-items:center;gap:.35rem}
.special-intro-tuner details{position:relative}
.special-intro-tuner summary{cursor:pointer;white-space:nowrap}
.special-intro-tuner-panel{position:absolute;z-index:12000;right:0;top:calc(100% + 8px);width:min(340px,88vw);padding:12px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:#171722;box-shadow:0 12px 35px rgba(0,0,0,.45);display:grid;gap:9px}
.special-intro-tuner-panel label{display:grid;grid-template-columns:88px 1fr 48px;gap:8px;align-items:center;font-size:12px}
.special-intro-tuner-panel input[type=range]{width:100%}
.special-intro-tuner-panel output{text-align:right;font-variant-numeric:tabular-nums}
.special-intro-tuner-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:2px}
`;

    const overlay = this.document.createElement('div');
    overlay.id = 'special-summon-intro';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="special-intro-pink"></div>
      <img class="special-intro-enemy" src="${WALPURGIS_IMAGE_SRC}" alt="">
      <div class="special-intro-title"><div class="special-intro-brush"><img class="special-intro-runes" src="${WALPURGIS_RUNES_SRC}" alt=""></div></div>
      <div class="special-intro-white"></div>
      <div class="special-intro-negative"></div>`;
    this.document.head.append(style);
    this.document.body.append(overlay);
    return overlay;
  }

  _installControls() {
    const settings = this.document?.querySelector?.('.settings');
    if (!settings || this.document.querySelector('#special-intro-preview')) return;

    const wrap = this.document.createElement('span');
    wrap.className = 'special-intro-tuner';
    wrap.innerHTML = `
      <button id="special-intro-preview" type="button" class="quiet">ワルプル演出プレビュー</button>
      <details id="special-intro-timing">
        <summary>演出タイミング</summary>
        <div class="special-intro-tuner-panel">
          <label>全体 <input data-key="durationMs" type="range" min="1500" max="6000" step="100"><output></output></label>
          <label>本体出現 <input data-key="appearPct" type="range" min="0" max="55" step="1"><output></output></label>
          <label>文字開始 <input data-key="titlePct" type="range" min="5" max="80" step="1"><output></output></label>
          <label>反転開始 <input data-key="invertPct" type="range" min="10" max="90" step="1"><output></output></label>
          <label>反転時間 <input data-key="invertDurationPct" type="range" min="3" max="35" step="1"><output></output></label>
          <div class="special-intro-tuner-actions">
            <button type="button" class="quiet" data-action="reset">初期値</button>
            <button type="button" class="primary" data-action="preview">この設定で再生</button>
          </div>
        </div>
      </details>`;
    settings.append(wrap);

    const sync = () => {
      for (const input of wrap.querySelectorAll('input[type=range]')) {
        const key = input.dataset.key;
        input.value = String(this.timing[key]);
        const out = input.parentElement.querySelector('output');
        out.value = key === 'durationMs' ? `${(this.timing[key] / 1000).toFixed(1)}s` : `${Math.round(this.timing[key])}%`;
      }
    };

    wrap.addEventListener('input', event => {
      const input = event.target.closest?.('input[type=range]');
      if (!input) return;
      this.timing = normalizeIntroTiming({ ...this.timing, [input.dataset.key]: Number(input.value) });
      this._saveTiming();
      sync();
    });
    wrap.querySelector('#special-intro-preview').addEventListener('click', () => this.preview());
    wrap.querySelector('[data-action=preview]').addEventListener('click', () => this.preview());
    wrap.querySelector('[data-action=reset]').addEventListener('click', () => {
      this.timing = normalizeIntroTiming(DEFAULT_INTRO_TIMING);
      this._saveTiming();
      sync();
    });
    sync();
  }

  _characterIdForEvent(event) {
    const cardId = String(event?.card?.id ?? '');
    const fromCard = CHARACTER_IDS.find(characterId =>
      cardId.includes(`-${characterId}-`) || cardId.startsWith(`${characterId}-`)
    );
    if (fromCard) return fromCard;
    return this.document?.querySelector?.('#top-player.active, #bottom-player.active')?.dataset?.character ?? null;
  }

  _waitForVoice(characterId) {
    const audio = this.voices[characterId];
    if (!audio) return Promise.resolve(false);

    this.currentVoice = audio;
    audio.pause();
    audio.currentTime = 0;
    return new Promise(resolve => {
      let settled = false;
      const done = played => {
        if (settled) return;
        settled = true;
        NATIVE_CLEAR_TIMEOUT(this.voiceTimer);
        audio.removeEventListener?.('ended', onEnded);
        audio.removeEventListener?.('error', onError);
        if (this.currentVoice === audio) this.currentVoice = null;
        resolve(played);
      };
      const onEnded = () => done(true);
      const onError = () => done(false);
      audio.addEventListener?.('ended', onEnded, { once: true });
      audio.addEventListener?.('error', onError, { once: true });
      this.voiceTimer = NATIVE_SET_TIMEOUT(() => done(true), 30000);
      try {
        const result = audio.play();
        if (result?.catch) result.catch(() => done(false));
      } catch {
        done(false);
      }
    });
  }

  _cancelAnimations() {
    for (const animation of this.animations) animation?.cancel?.();
    this.animations = [];
  }

  _animateScene() {
    if (!this.overlay) return;
    this._cancelAnimations();
    const duration = this.timing.durationMs;
    const appear = pct(this.timing.appearPct);
    const title = pct(this.timing.titlePct);
    const invert = pct(this.timing.invertPct);
    const invertEnd = clamp01(invert + pct(this.timing.invertDurationPct));
    const titleHoldEnd = clamp01(Math.max(title + .12, Math.min(invertEnd + .03, .88)));
    const titleFadeEnd = clamp01(Math.min(titleHoldEnd + .06, .96));

    const enemy = this.overlay.querySelector('.special-intro-enemy');
    const pink = this.overlay.querySelector('.special-intro-pink');
    const white = this.overlay.querySelector('.special-intro-white');
    const titleLayer = this.overlay.querySelector('.special-intro-title');
    const brush = this.overlay.querySelector('.special-intro-brush');
    const negative = this.overlay.querySelector('.special-intro-negative');

    this.animations.push(
      enemy.animate([
        { opacity: 0, filter: 'brightness(1.6) blur(2px) drop-shadow(0 0 20px rgba(255,70,180,.8))', offset: 0 },
        { opacity: 0, filter: 'brightness(1.6) blur(2px) drop-shadow(0 0 20px rgba(255,70,180,.8))', offset: appear },
        { opacity: 1, filter: 'brightness(1.3) blur(0) drop-shadow(0 14px 20px rgba(0,0,0,.65))', offset: clamp01(appear + .08) },
        { opacity: 1, filter: 'brightness(1) drop-shadow(0 14px 20px rgba(0,0,0,.7))', offset: clamp01(appear + .16) },
        { opacity: 1, filter: 'brightness(1) drop-shadow(0 14px 20px rgba(0,0,0,.7))', offset: 1 },
      ], { duration, fill: 'both', easing: 'linear' }),
      pink.animate([
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: clamp01(appear - .03) },
        { opacity: .15, offset: appear },
        { opacity: 1, offset: clamp01(appear + .04) },
        { opacity: .25, offset: clamp01(appear + .09) },
        { opacity: 0, offset: clamp01(appear + .14) },
        { opacity: 0, offset: 1 },
      ], { duration, fill: 'both', easing: 'linear' }),
      white.animate([
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: clamp01(appear + .02) },
        { opacity: .85, offset: clamp01(appear + .06) },
        { opacity: 0, offset: clamp01(appear + .09) },
        { opacity: 0, offset: clamp01(invert - .02) },
        { opacity: .18, offset: clamp01(invert - .01) },
        { opacity: 0, offset: invert },
        { opacity: 0, offset: 1 },
      ], { duration, fill: 'both', easing: 'linear' }),
      titleLayer.animate([
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: clamp01(title - .02) },
        { opacity: 1, offset: title },
        { opacity: 1, offset: titleHoldEnd },
        { opacity: 0, offset: titleFadeEnd },
        { opacity: 0, offset: 1 },
      ], { duration, fill: 'both', easing: 'ease-out' }),
      brush.animate([
        { transform: 'translateX(16vw) scaleX(.25)', opacity: 0, offset: 0 },
        { transform: 'translateX(16vw) scaleX(.25)', opacity: 0, offset: clamp01(title - .02) },
        { transform: 'translateX(0) scaleX(1)', opacity: 1, offset: title },
        { transform: 'translateX(0) scaleX(1)', opacity: 1, offset: titleHoldEnd },
        { transform: 'translateX(-4vw) scaleX(.95)', opacity: 0, offset: titleFadeEnd },
        { transform: 'translateX(-4vw) scaleX(.95)', opacity: 0, offset: 1 },
      ], { duration, fill: 'both', easing: 'ease-out' }),
      negative.animate([
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: clamp01(invert - .001) },
        { opacity: 1, offset: invert },
        { opacity: 1, offset: invertEnd },
        { opacity: 0, offset: clamp01(invertEnd + .001) },
        { opacity: 0, offset: 1 },
      ], { duration, fill: 'both', easing: 'steps(1, end)' }),
    );
  }

  _startScene({ startBgm = true, preview = false } = {}) {
    if (!this.overlay) {
      if (!preview) this._finish();
      return;
    }
    if (startBgm) this.window?.dispatchEvent?.(new CustomEvent('duel:special-bgm'));
    this.previewing = preview;
    this.overlay.hidden = false;
    nextFrame(this.overlay);
    this._animateScene();
    NATIVE_CLEAR_TIMEOUT(this.sceneTimer);
    this.sceneTimer = NATIVE_SET_TIMEOUT(() => this._finish(), this.timing.durationMs);
  }

  preview() {
    if (this.running || this.previewing) this._finish({ notifyGame: this.running });
    this.running = false;
    this.previewing = true;
    this._startScene({ startBgm: false, preview: true });
  }

  _finish({ notifyGame = true } = {}) {
    NATIVE_CLEAR_TIMEOUT(this.sceneTimer);
    NATIVE_CLEAR_TIMEOUT(this.voiceTimer);
    this.sceneTimer = null;
    this.voiceTimer = null;
    this._cancelAnimations();
    if (this.currentVoice) {
      this.currentVoice.pause();
      this.currentVoice.currentTime = 0;
      this.currentVoice = null;
    }
    if (this.overlay) this.overlay.hidden = true;
    const wasRunning = this.running;
    this.running = false;
    this.previewing = false;
    globalThis.__duelCutsceneActive = false;
    if (notifyGame && wasRunning) this.window?.dispatchEvent?.(new CustomEvent('duel:cutscene-end'));
  }

  async handleEvent(event) {
    if (!isSpecialWitchSummon(event)) return false;
    if (this.previewing) this._finish({ notifyGame: false });
    if (this.running) return false;
    this.running = true;
    globalThis.__duelCutsceneActive = true;
    const characterId = this._characterIdForEvent(event);
    await this._waitForVoice(characterId);
    if (!this.running) return true;
    this._startScene({ startBgm: true, preview: false });
    return true;
  }

  reset() {
    if (!this.running && !this.previewing && !this.currentVoice && this.overlay?.hidden) return;
    this._finish({ notifyGame: this.running });
  }
}

function bootstrap() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Audio === 'undefined') return;
  installCutsceneTimerGate(window);
  const intro = new SpecialSummonIntro();
  window.addEventListener('duel:event', event => intro.handleEvent(event.detail));
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (!button) return;
    const gameOver = document.querySelector('#turn-name')?.textContent === 'デュエル終了';
    if (button.id === 'confirm-restart'
      || (button.id === 'new-game' && gameOver)
      || (button.closest('#actions') && button.textContent === 'もう一度対戦')) intro.reset();
  }, true);
}

bootstrap();
