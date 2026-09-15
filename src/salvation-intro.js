const WALPURGIS_CODE = 'witch-walpurgis_13';
const SALVATION_CODE = 'witch-salvation_13';
const WALPURGIS_IMAGE_SRC = './assets/special-intro/walpurgis.webp?v=special-intro3';
const WALPURGIS_RUNES_SRC = './assets/special-intro/walpurgis-runes.png?v=special-intro3';
const SALVATION_IMAGE_SRC = './assets/cards/madoka/witch_salvation_13.webp?v=cards-webp1';
const SALVATION_RUNES_SRC = 'data:image/webp;base64,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';

const SOURCES = Object.freeze({
  [WALPURGIS_CODE]: { kind: 'walpurgis', image: WALPURGIS_IMAGE_SRC, runes: WALPURGIS_RUNES_SRC },
  [SALVATION_CODE]: { kind: 'salvation', image: SALVATION_IMAGE_SRC, runes: SALVATION_RUNES_SRC },
});

function applyAssets(code) {
  const source = SOURCES[code] ?? SOURCES[WALPURGIS_CODE];
  const overlay = document.querySelector('#special-summon-intro');
  if (!overlay) return false;
  overlay.dataset.witch = source.kind;
  const enemy = overlay.querySelector('.special-intro-enemy');
  const runes = overlay.querySelector('.special-intro-runes');
  if (enemy) enemy.src = source.image;
  if (runes) runes.src = source.runes;
  return true;
}

function installStyle() {
  if (document.querySelector('#salvation-intro-style')) return;
  const style = document.createElement('style');
  style.id = 'salvation-intro-style';
  style.textContent = `
#special-summon-intro[data-witch="salvation"] .special-intro-enemy{
  left:27%;
  width:min(38vw,500px);
  max-height:88vh;
  transform:translate(-50%,-50%) scale(.82);
}
#special-summon-intro[data-witch="salvation"] .special-intro-runes{
  width:min(50vw,680px);
  max-height:118px;
}
`;
  document.head.append(style);
}

function installPreview() {
  const walpurgisButton = document.querySelector('#special-intro-preview');
  const wrap = walpurgisButton?.closest('.special-intro-tuner');
  if (!walpurgisButton || !wrap || document.querySelector('#salvation-intro-preview')) return false;

  const button = document.createElement('button');
  button.id = 'salvation-intro-preview';
  button.type = 'button';
  button.className = 'quiet';
  button.textContent = '救済演出プレビュー';
  walpurgisButton.after(button);
  button.addEventListener('click', () => {
    applyAssets(SALVATION_CODE);
    wrap.querySelector('[data-action="preview"]')?.click();
  });
  return true;
}

function bootstrap() {
  installStyle();

  document.addEventListener('click', event => {
    if (event.target.closest?.('#special-intro-preview')) applyAssets(WALPURGIS_CODE);
  }, true);

  window.addEventListener('duel:event', event => {
    const detail = event.detail;
    if (!['summon', 'revive'].includes(detail?.type)) return;
    if (detail.card?.code === SALVATION_CODE) applyAssets(SALVATION_CODE);
    else if (detail.card?.code === WALPURGIS_CODE) applyAssets(WALPURGIS_CODE);
  });

  if (!installPreview()) {
    const observer = new MutationObserver(() => {
      if (installPreview()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
}
