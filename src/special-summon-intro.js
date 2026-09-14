const SPECIAL_WITCH_CODES = new Set(['witch-walpurgis_13', 'witch-salvation_13']);
const CHARACTER_IDS = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura', 'nagisa'];

const WALPURGIS_IMAGE_SRC = './assets/special-intro/walpurgis.webp?v=special-intro2';
const WALPURGIS_RUNES_SRC = './assets/special-intro/walpurgis-runes.png?v=special-intro2';

export const DOPPEL_VOICE_SOURCES = Object.freeze({
  madoka: './assets/audio/doppel/madoka.mp3?v=doppel2',
  mami: './assets/audio/doppel/mami.mp3?v=doppel2',
  sayaka: null,
  kyoko: null,
  homura: null,
  nagisa: null,
});

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

export class SpecialSummonIntro {
  constructor({
    documentRef = globalThis.document,
    windowRef = globalThis.window,
    AudioCtor = globalThis.Audio,
    durationMs = 4800,
  } = {}) {
    this.document = documentRef;
    this.window = windowRef;
    this.AudioCtor = AudioCtor;
    this.durationMs = durationMs;
    this.running = false;
    this.sceneTimer = null;
    this.voiceTimer = null;
    this.currentVoice = null;
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
  }

  _createOverlay() {
    const existing = this.document?.querySelector?.('#special-summon-intro');
    if (existing) return existing;
    if (!this.document?.body) return null;

    const style = this.document.createElement('style');
    style.id = 'special-summon-intro-style';
    style.textContent = `
#special-summon-intro[hidden]{display:none!important}
#special-summon-intro{position:fixed;inset:0;z-index:10000;overflow:hidden;background:radial-gradient(circle at 25% 25%,rgba(120,80,160,.32),transparent 28%),radial-gradient(circle at 78% 20%,rgba(210,70,120,.25),transparent 24%),linear-gradient(180deg,#251831 0%,#1b1628 48%,#0f1016 100%);pointer-events:auto;isolation:isolate}
#special-summon-intro::before{content:"";position:absolute;inset:0;z-index:0;background:radial-gradient(circle at 20% 18%,rgba(255,255,255,.05),transparent 10%),radial-gradient(circle at 75% 20%,rgba(255,255,255,.04),transparent 12%),repeating-radial-gradient(circle at 50% 58%,rgba(255,255,255,.04) 0 2px,transparent 3px 18px);opacity:.6}
.special-intro-floor{position:absolute;z-index:0;left:-8%;right:-8%;bottom:-8%;height:46%;background:repeating-radial-gradient(ellipse at center,rgba(255,255,255,.10) 0 2px,transparent 3px 18px),linear-gradient(180deg,rgba(20,25,34,.25),rgba(12,13,18,.9));transform:perspective(600px) rotateX(61deg);transform-origin:bottom}
.special-intro-enemy{position:absolute;z-index:2;left:27%;top:50%;width:min(40vw,520px);max-height:82vh;object-fit:contain;transform:translate(-50%,-50%) scale(.78) rotate(-2deg);opacity:0;filter:drop-shadow(0 18px 28px rgba(0,0,0,.82));will-change:opacity,filter;display:block}
.special-intro-pink,.special-intro-white,.special-intro-negative,.special-intro-title{position:absolute;inset:0;pointer-events:none}
.special-intro-pink{z-index:1;background:radial-gradient(circle at 35% 45%,rgba(255,255,255,.96),rgba(255,90,180,.72) 18%,rgba(185,40,210,.34) 38%,transparent 62%);opacity:0;mix-blend-mode:screen}
.special-intro-white{z-index:4;background:#fff;opacity:0;mix-blend-mode:screen}
.special-intro-negative{z-index:5;background:#fff;opacity:0;mix-blend-mode:difference}
.special-intro-title{z-index:3;display:flex;align-items:center;justify-content:flex-end;padding-right:6vw;box-sizing:border-box;opacity:0}
.special-intro-brush{position:relative;width:min(62vw,920px);height:210px;display:flex;align-items:center;justify-content:center;transform:translateX(16vw)}
.special-intro-brush::before{content:"";position:absolute;inset:0;background:#080607;clip-path:polygon(2% 18%,8% 10%,15% 18%,24% 5%,31% 14%,40% 6%,48% 15%,56% 2%,64% 14%,73% 8%,83% 17%,96% 11%,92% 32%,99% 41%,93% 50%,98% 62%,89% 68%,96% 85%,82% 82%,73% 92%,62% 83%,51% 96%,40% 85%,30% 94%,21% 82%,10% 90%,15% 70%,4% 63%,11% 51%,3% 41%,10% 31%);filter:drop-shadow(0 0 7px rgba(0,0,0,.9))}
.special-intro-brush::after{content:"";position:absolute;inset:18px 30px;background:linear-gradient(90deg,transparent 0 5%,rgba(255,255,255,.08) 5% 7%,transparent 8% 24%,rgba(255,255,255,.07) 25% 28%,transparent 29% 100%);opacity:.8}
.special-intro-runes{position:relative;z-index:2;width:min(48vw,620px);max-width:100%;max-height:105px;object-fit:contain;display:block;filter:brightness(0) invert(1) drop-shadow(0 0 9px rgba(255,255,255,.28))}
#special-summon-intro.run .special-intro-enemy{animation:specialEnemy 4.8s linear both}
#special-summon-intro.run .special-intro-pink{animation:specialPink 4.8s linear both}
#special-summon-intro.run .special-intro-white{animation:specialWhite 4.8s linear both}
#special-summon-intro.run .special-intro-title{animation:specialTitle 4.8s ease-out both}
#special-summon-intro.run .special-intro-brush{animation:specialBrush 4.8s ease-out both}
#special-summon-intro.run .special-intro-negative{animation:specialNegative 4.8s steps(1,end) both}
@keyframes specialPink{0%,10%{opacity:0}12%{opacity:.15}16%{opacity:1}21%{opacity:.25}26%,100%{opacity:0}}
@keyframes specialWhite{0%,14%{opacity:0}18%{opacity:.85}21%{opacity:0}50%{opacity:0}51%{opacity:.18}52%,100%{opacity:0}}
@keyframes specialEnemy{0%,12%{opacity:0;filter:brightness(1.6) blur(2px) drop-shadow(0 0 20px rgba(255,70,180,.8))}20%{opacity:1;filter:brightness(1.35) blur(0) drop-shadow(0 14px 20px rgba(0,0,0,.65))}28%,100%{opacity:1;filter:brightness(1) drop-shadow(0 14px 20px rgba(0,0,0,.7))}}
@keyframes specialTitle{0%,34%{opacity:0}38%,62%{opacity:1}67%,100%{opacity:0}}
@keyframes specialBrush{0%,34%{transform:translateX(16vw) scaleX(.25);opacity:0}38%{transform:translateX(0) scaleX(1);opacity:1}62%{transform:translateX(0) scaleX(1);opacity:1}67%,100%{transform:translateX(-4vw) scaleX(.95);opacity:0}}
@keyframes specialNegative{0%,50%{opacity:0}51%,60%{opacity:1}61%,100%{opacity:0}}
`;

    const overlay = this.document.createElement('div');
    overlay.id = 'special-summon-intro';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="special-intro-floor"></div>
      <div class="special-intro-pink"></div>
      <img class="special-intro-enemy" src="${WALPURGIS_IMAGE_SRC}" alt="">
      <div class="special-intro-title"><div class="special-intro-brush"><img class="special-intro-runes" src="${WALPURGIS_RUNES_SRC}" alt=""></div></div>
      <div class="special-intro-white"></div>
      <div class="special-intro-negative"></div>`;
    this.document.head.append(style);
    this.document.body.append(overlay);
    return overlay;
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

  _startScene() {
    this.window?.dispatchEvent?.(new CustomEvent('duel:special-bgm'));
    if (!this.overlay) {
      this._finish();
      return;
    }
    this.overlay.hidden = false;
    this.overlay.classList.remove('run');
    void this.overlay.offsetWidth;
    this.overlay.classList.add('run');
    this.sceneTimer = NATIVE_SET_TIMEOUT(() => this._finish(), this.durationMs);
  }

  _finish() {
    NATIVE_CLEAR_TIMEOUT(this.sceneTimer);
    NATIVE_CLEAR_TIMEOUT(this.voiceTimer);
    this.sceneTimer = null;
    this.voiceTimer = null;
    if (this.currentVoice) {
      this.currentVoice.pause();
      this.currentVoice.currentTime = 0;
      this.currentVoice = null;
    }
    if (this.overlay) {
      this.overlay.classList.remove('run');
      this.overlay.hidden = true;
    }
    this.running = false;
    globalThis.__duelCutsceneActive = false;
    this.window?.dispatchEvent?.(new CustomEvent('duel:cutscene-end'));
  }

  async handleEvent(event) {
    if (!isSpecialWitchSummon(event) || this.running) return false;
    this.running = true;
    globalThis.__duelCutsceneActive = true;
    const characterId = this._characterIdForEvent(event);
    await this._waitForVoice(characterId);
    if (!this.running) return true;
    this._startScene();
    return true;
  }

  reset() {
    if (!this.running && !this.currentVoice && this.overlay?.hidden) return;
    this._finish();
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
