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
    invertLabel.firstChild.textContent = '名前完成→反転 ';
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

  let endTimer = null;

  const setNegative = active => {
    // Instant whole-screen switch. No opacity tween.
    layer.hidden = !active;
  };

  const stop = () => {
    clearTimeout(endTimer);
    endTimer = null;
    setNegative(false);
  };

  const armSafetyReset = () => {
    stop();
    const timing = readTiming();
    const duration = Math.max(1, Number(timing.durationMs) || FALLBACK_TIMING.durationMs);
    // Normal path resets when the intro overlay is hidden. This is only a Safari fallback.
    endTimer = setTimeout(() => {
      setNegative(false);
      endTimer = null;
    }, duration + 64);
  };

  const attach = overlay => {
    if (!overlay || overlay.dataset.globalNegativeBound === '1') return;
    overlay.dataset.globalNegativeBound = '1';
    const sync = () => overlay.hidden ? stop() : armSafetyReset();
    new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  };

  // The sequence controller emits this only after the witch name animation has
  // reached its final frame. From here until intro end the negative state stays on.
  window.addEventListener('duel:special-name-complete', () => {
    const overlay = document.querySelector('#special-summon-intro');
    if (!overlay || overlay.hidden) return;
    setNegative(true);
  });

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
