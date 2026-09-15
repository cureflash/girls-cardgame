const STORAGE_KEY = 'walpurgisIntroTimingV1';

const FALLBACK_TIMING = Object.freeze({
  durationMs: 2300,
  appearPct: 12,
  disappearPct: 70,
  titlePct: 34,
  invertPct: 39,
  invertDurationPct: 3,
});

function readTiming() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(FALLBACK_TIMING));
      return { ...FALLBACK_TIMING };
    }
    return { ...FALLBACK_TIMING, ...JSON.parse(raw) };
  } catch {
    return { ...FALLBACK_TIMING };
  }
}

function hideObsoleteControls() {
  for (const key of ['disappearPct', 'invertDurationPct']) {
    const input = document.querySelector(`input[data-key="${key}"]`);
    const label = input?.closest?.('label');
    if (label) label.hidden = true;
  }

  const invertInput = document.querySelector('input[data-key="invertPct"]');
  const invertLabel = invertInput?.closest?.('label');
  if (invertLabel?.firstChild?.nodeType === Node.TEXT_NODE) {
    invertLabel.firstChild.textContent = '文字完成→反転 ';
  }
}

function installGlobalNegativeLayer() {
  if (document.querySelector('#special-intro-global-negative')) return;

  const style = document.createElement('style');
  style.id = 'special-intro-global-negative-style';
  style.textContent = `
#special-summon-intro .special-intro-negative{display:none!important}
#special-intro-global-negative{
  position:fixed;
  inset:0;
  z-index:2147483647;
  pointer-events:none;
  background:#fff;
  mix-blend-mode:difference;
  opacity:1;
  transition:none!important;
  animation:none!important;
}
#special-intro-global-negative[hidden]{display:none!important}
`;
  document.head.append(style);

  const layer = document.createElement('div');
  layer.id = 'special-intro-global-negative';
  layer.hidden = true;
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);

  let startTimer = null;
  let endTimer = null;

  const setNegative = active => {
    // Flip the complete game view instantly. No fade or tween.
    layer.hidden = !active;
  };

  const stop = () => {
    clearTimeout(startTimer);
    clearTimeout(endTimer);
    startTimer = null;
    endTimer = null;
    setNegative(false);
  };

  const play = () => {
    stop();
    const timing = readTiming();
    const duration = Math.max(1, Number(timing.durationMs) || FALLBACK_TIMING.durationMs);
    const appear = Math.max(0, Math.min(1, Number(timing.appearPct) / 100));
    const title = Math.max(0, Math.min(.88, Number(timing.titlePct) / 100));
    const requestedInvert = Math.max(0, Math.min(1, Number(timing.invertPct) / 100));
    const titleStart = Math.max(appear + .08, title);
    // The negative switch happens at the same point that the name animation reaches its final frame.
    const start = Math.min(1, Math.max(titleStart + .03, requestedInvert));
    const startMs = Math.round(duration * start);

    // Switch to negative instantly, then keep it for the rest of the intro.
    startTimer = setTimeout(() => {
      setNegative(true);
      startTimer = null;
    }, startMs);

    // Safety reset: the overlay observer normally clears this exactly when the intro disappears.
    endTimer = setTimeout(() => {
      setNegative(false);
      endTimer = null;
    }, duration + 32);
  };

  const attach = overlay => {
    if (!overlay || overlay.dataset.globalNegativeBound === '1') return;
    overlay.dataset.globalNegativeBound = '1';
    const sync = () => overlay.hidden ? stop() : play();
    new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  };

  // Real summon cutscenes dispatch this event when they finish.
  window.addEventListener('duel:cutscene-end', stop);
  window.addEventListener('pagehide', stop);

  attach(document.querySelector('#special-summon-intro'));
  new MutationObserver(() => {
    attach(document.querySelector('#special-summon-intro'));
    hideObsoleteControls();
  }).observe(document.body, { childList: true, subtree: true });
  hideObsoleteControls();
}

function bootstrap() {
  if (typeof document === 'undefined') return;
  readTiming();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installGlobalNegativeLayer, { once: true });
  } else {
    installGlobalNegativeLayer();
  }
}

bootstrap();
