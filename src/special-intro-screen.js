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
    // hidden is switched directly: no opacity tween, no CSS animation.
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
    const start = Math.max(0, Math.min(1, Number(timing.invertPct) / 100));
    const end = Math.max(start, Math.min(1, start + Number(timing.invertDurationPct) / 100));
    const startMs = Math.round(duration * start);
    const endMs = Math.round(duration * end);

    startTimer = setTimeout(() => {
      setNegative(true);
      startTimer = null;
    }, startMs);

    endTimer = setTimeout(() => {
      setNegative(false);
      endTimer = null;
    }, endMs);
  };

  const attach = overlay => {
    if (!overlay || overlay.dataset.globalNegativeBound === '1') return;
    overlay.dataset.globalNegativeBound = '1';
    const sync = () => overlay.hidden ? stop() : play();
    new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  };

  attach(document.querySelector('#special-summon-intro'));
  new MutationObserver(() => attach(document.querySelector('#special-summon-intro')))
    .observe(document.body, { childList: true, subtree: true });
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
