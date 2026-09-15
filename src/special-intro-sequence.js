const STORAGE_KEY = 'walpurgisIntroTimingV1';

const FALLBACK = Object.freeze({
  durationMs: 2300,
  appearPct: 12,
  titlePct: 34,
  invertPct: 39,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function readTiming() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...FALLBACK, ...saved };
  } catch {
    return { ...FALLBACK };
  }
}

function cancelAnimations(element) {
  for (const animation of element?.getAnimations?.() ?? []) animation.cancel();
}

function hideObsoleteControls() {
  const disappear = document.querySelector('input[data-key="disappearPct"]')?.closest?.('label');
  if (disappear) disappear.hidden = true;

  const invertDuration = document.querySelector('input[data-key="invertDurationPct"]')?.closest?.('label');
  if (invertDuration) invertDuration.hidden = true;

  const invertInput = document.querySelector('input[data-key="invertPct"]');
  const invertLabel = invertInput?.closest?.('label');
  if (invertLabel?.firstChild?.nodeType === Node.TEXT_NODE) {
    invertLabel.firstChild.textContent = '名前完成→反転 ';
  }
}

function installHoldStyle() {
  if (document.querySelector('#special-intro-sequence-style')) return;
  const style = document.createElement('style');
  style.id = 'special-intro-sequence-style';
  style.textContent = `
#special-summon-intro.special-intro-name-held .special-intro-enemy,
#special-summon-intro.special-intro-name-held .special-intro-title,
#special-summon-intro.special-intro-name-held .special-intro-brush{
  opacity:1!important;
}
#special-summon-intro.special-intro-name-held .special-intro-brush{
  transform:translateX(0) scaleX(1)!important;
}
`;
  document.head.append(style);
}

function installSequenceController() {
  const overlay = document.querySelector('#special-summon-intro');
  if (!overlay || overlay.dataset.sequenceControllerBound === '1') return false;
  overlay.dataset.sequenceControllerBound = '1';

  let animations = [];
  let nameCompleteTimer = null;

  const stop = () => {
    clearTimeout(nameCompleteTimer);
    nameCompleteTimer = null;
    overlay.classList.remove('special-intro-name-held');
    for (const animation of animations) animation?.cancel?.();
    animations = [];
  };

  const play = () => {
    if (overlay.hidden) return;
    stop();

    const timing = readTiming();
    const duration = Math.max(1, Number(timing.durationMs) || FALLBACK.durationMs);
    const appear = clamp01(Number(timing.appearPct) / 100);
    const rawTitle = clamp01(Number(timing.titlePct) / 100);
    const rawInvert = clamp01(Number(timing.invertPct) / 100);

    // Fixed order for both Walpurgisnacht and the Salvation Witch:
    // witch appears -> name animates fully -> negative switches instantly.
    const titleStart = Math.max(appear + 0.08, Math.min(rawTitle, 0.88));
    const nameComplete = Math.min(1, Math.max(titleStart + 0.03, rawInvert));
    const titleLead = Math.max(0, titleStart - 0.015);
    const enemyVisible = Math.min(titleStart, appear + 0.08);

    const enemy = overlay.querySelector('.special-intro-enemy');
    const titleLayer = overlay.querySelector('.special-intro-title');
    const brush = overlay.querySelector('.special-intro-brush');
    const white = overlay.querySelector('.special-intro-white');

    // Remove the original fade-out timelines. These elements must remain visible
    // after name completion, through the negative phase, until the overlay itself ends.
    cancelAnimations(enemy);
    cancelAnimations(titleLayer);
    cancelAnimations(brush);
    cancelAnimations(white);

    if (enemy) {
      animations.push(enemy.animate([
        { opacity: 0, filter: 'brightness(1.6) blur(2px) drop-shadow(0 0 20px rgba(255,70,180,.8))', offset: 0 },
        { opacity: 0, filter: 'brightness(1.6) blur(2px) drop-shadow(0 0 20px rgba(255,70,180,.8))', offset: appear },
        { opacity: 1, filter: 'brightness(1.25) blur(0) drop-shadow(0 14px 20px rgba(0,0,0,.65))', offset: enemyVisible },
        { opacity: 1, filter: 'brightness(1) drop-shadow(0 14px 20px rgba(0,0,0,.7))', offset: Math.min(1, enemyVisible + 0.06) },
        { opacity: 1, filter: 'brightness(1) drop-shadow(0 14px 20px rgba(0,0,0,.7))', offset: 1 },
      ], { duration, fill: 'both', easing: 'linear' }));
    }

    if (titleLayer) {
      animations.push(titleLayer.animate([
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: titleLead },
        { opacity: 1, offset: titleStart },
        { opacity: 1, offset: nameComplete },
        { opacity: 1, offset: 1 },
      ], { duration, fill: 'both', easing: 'linear' }));
    }

    if (brush) {
      animations.push(brush.animate([
        { transform: 'translateX(16vw) scaleX(.25)', opacity: 0, offset: 0 },
        { transform: 'translateX(16vw) scaleX(.25)', opacity: 0, offset: titleLead },
        { transform: 'translateX(12vw) scaleX(.35)', opacity: .2, offset: titleStart },
        { transform: 'translateX(0) scaleX(1)', opacity: 1, offset: nameComplete },
        { transform: 'translateX(0) scaleX(1)', opacity: 1, offset: 1 },
      ], { duration, fill: 'both', easing: 'ease-out' }));
    }

    // Keep only the initial appearance flash.
    if (white) {
      animations.push(white.animate([
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: Math.max(0, appear + 0.02) },
        { opacity: .85, offset: Math.min(1, appear + 0.06) },
        { opacity: 0, offset: Math.min(1, appear + 0.09) },
        { opacity: 0, offset: 1 },
      ], { duration, fill: 'both', easing: 'linear' }));
    }

    // This is the single source of truth for the negative switch. At this exact
    // moment the name is forced into its completed state and held there.
    const completeMs = Math.round(duration * nameComplete);
    nameCompleteTimer = setTimeout(() => {
      if (overlay.hidden) return;
      overlay.classList.add('special-intro-name-held');
      window.dispatchEvent(new CustomEvent('duel:special-name-complete', {
        detail: { nameComplete, durationMs: duration },
      }));
      nameCompleteTimer = null;
    }, completeMs);
  };

  const sync = () => {
    if (overlay.hidden) stop();
    else play();
  };

  new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  sync();
  return true;
}

function bootstrap() {
  const install = () => {
    installHoldStyle();
    hideObsoleteControls();
    installSequenceController();
  };

  install();
  new MutationObserver(install).observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
}
