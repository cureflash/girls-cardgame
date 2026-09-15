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
  opacity:0;
}
`;
  document.head.append(style);

  const layer = document.createElement('div');
  layer.id = 'special-intro-global-negative';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);

  let animation = null;
  const play = () => {
    animation?.cancel?.();
    const timing = readTiming();
    const duration = Math.max(1, Number(timing.durationMs) || FALLBACK_TIMING.durationMs);
    const start = Math.max(0, Math.min(1, Number(timing.invertPct) / 100));
    const end = Math.max(start, Math.min(1, start + Number(timing.invertDurationPct) / 100));
    const before = Math.max(0, start - 0.001);
    const after = Math.min(1, end + 0.001);

    animation = layer.animate([
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: before },
      { opacity: 1, offset: start },
      { opacity: 1, offset: end },
      { opacity: 0, offset: after },
      { opacity: 0, offset: 1 },
    ], { duration, fill: 'both', easing: 'steps(1, end)' });
  };

  const stop = () => {
    animation?.cancel?.();
    animation = null;
    layer.style.opacity = '0';
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
