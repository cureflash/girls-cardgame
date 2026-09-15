const WALPURGIS_CODE = 'witch-walpurgis_13';
const SALVATION_CODE = 'witch-salvation_13';
const STORAGE_KEY = 'specialIntroAssetLayoutV1';

const WALPURGIS_IMAGE_SRC = './assets/special-intro/walpurgis.webp?v=special-intro3';
// Use the full-resolution Salvation Witch art rather than the reduced card WebP.
const SALVATION_IMAGE_SRC = './assets/cards/madoka/witch_salvation_13.png?v=salvation-art2';

const DEFAULTS = Object.freeze({
  walpurgis: Object.freeze({ x: 27, y: 50, scale: 78 }),
  salvation: Object.freeze({ x: 27, y: 50, scale: 82 }),
});

let layouts = loadLayouts();
let activeKind = 'walpurgis';

function normalizedLayout(value, fallback) {
  const number = (key, min, max) => {
    const raw = Number(value?.[key]);
    const base = Number.isFinite(raw) ? raw : fallback[key];
    return Math.max(min, Math.min(max, base));
  };
  return {
    x: number('x', 0, 100),
    y: number('y', 0, 100),
    scale: number('scale', 30, 180),
  };
}

function loadLayouts() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      walpurgis: normalizedLayout(saved.walpurgis, DEFAULTS.walpurgis),
      salvation: normalizedLayout(saved.salvation, DEFAULTS.salvation),
    };
  } catch {
    return {
      walpurgis: { ...DEFAULTS.walpurgis },
      salvation: { ...DEFAULTS.salvation },
    };
  }
}

function saveLayouts() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts)); } catch {}
}

function overlay() {
  return document.querySelector('#special-summon-intro');
}

function currentKind() {
  return overlay()?.dataset?.witch === 'salvation' ? 'salvation' : activeKind;
}

function imageFor(kind) {
  return kind === 'salvation' ? SALVATION_IMAGE_SRC : WALPURGIS_IMAGE_SRC;
}

function applyLayout(kind = currentKind()) {
  const root = overlay();
  const enemy = root?.querySelector('.special-intro-enemy');
  if (!root || !enemy) return false;

  activeKind = kind === 'salvation' ? 'salvation' : 'walpurgis';
  const cfg = layouts[activeKind];
  enemy.src = imageFor(activeKind);
  enemy.style.left = `${cfg.x}%`;
  enemy.style.top = `${cfg.y}%`;
  enemy.style.transform = `translate(-50%,-50%) scale(${cfg.scale / 100}) rotate(-2deg)`;
  syncControls();
  return true;
}

function setKindFromCode(code) {
  if (code === SALVATION_CODE) activeKind = 'salvation';
  else if (code === WALPURGIS_CODE) activeKind = 'walpurgis';
  setTimeout(() => applyLayout(activeKind), 0);
}

let controls = null;
function syncControls() {
  if (!controls) return;
  const kind = currentKind();
  const cfg = layouts[kind];
  const target = controls.querySelector('[data-layout-target]');
  if (target) target.textContent = kind === 'salvation' ? '救済の魔女' : 'ワルプルギスの夜';

  for (const input of controls.querySelectorAll('input[data-layout-key]')) {
    const key = input.dataset.layoutKey;
    input.value = String(cfg[key]);
    const out = input.parentElement.querySelector('output');
    if (out) out.value = key === 'scale' ? `${Math.round(cfg[key])}%` : `${Math.round(cfg[key])}%`;
  }
}

function installControls() {
  const settings = document.querySelector('.settings');
  if (!settings) return false;
  if (document.querySelector('#special-intro-layout')) return true;

  const wrap = document.createElement('span');
  wrap.className = 'special-intro-tuner';
  wrap.innerHTML = `
    <details id="special-intro-layout">
      <summary>アセット配置</summary>
      <div class="special-intro-tuner-panel">
        <div style="font-size:12px">対象：<b data-layout-target></b></div>
        <label>横位置 <input data-layout-key="x" type="range" min="0" max="100" step="1"><output></output></label>
        <label>縦位置 <input data-layout-key="y" type="range" min="0" max="100" step="1"><output></output></label>
        <label>大きさ <input data-layout-key="scale" type="range" min="30" max="180" step="1"><output></output></label>
        <div class="special-intro-tuner-actions">
          <button type="button" class="quiet" data-layout-action="reset">この対象を初期値</button>
        </div>
      </div>
    </details>`;
  settings.append(wrap);
  controls = wrap;

  wrap.addEventListener('input', event => {
    const input = event.target.closest?.('input[data-layout-key]');
    if (!input) return;
    const kind = currentKind();
    const key = input.dataset.layoutKey;
    layouts[kind] = normalizedLayout({ ...layouts[kind], [key]: Number(input.value) }, DEFAULTS[kind]);
    saveLayouts();
    applyLayout(kind);
  });

  wrap.querySelector('[data-layout-action="reset"]')?.addEventListener('click', () => {
    const kind = currentKind();
    layouts[kind] = { ...DEFAULTS[kind] };
    saveLayouts();
    applyLayout(kind);
  });

  syncControls();
  return true;
}

function bindOverlay() {
  const root = overlay();
  if (!root || root.dataset.layoutBound === '1') return false;
  root.dataset.layoutBound = '1';

  const observer = new MutationObserver(records => {
    if (records.some(record => record.attributeName === 'data-witch')) {
      activeKind = root.dataset.witch === 'salvation' ? 'salvation' : 'walpurgis';
      // salvation-intro.js updates src in the same task; apply after it finishes.
      setTimeout(() => applyLayout(activeKind), 0);
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-witch'] });
  applyLayout(root.dataset.witch === 'salvation' ? 'salvation' : 'walpurgis');
  return true;
}

function bootstrap() {
  const tryInstall = () => {
    installControls();
    bindOverlay();
  };
  tryInstall();

  document.addEventListener('click', event => {
    if (event.target.closest?.('#special-intro-preview')) {
      activeKind = 'walpurgis';
      setTimeout(() => applyLayout('walpurgis'), 0);
    } else if (event.target.closest?.('#salvation-intro-preview')) {
      activeKind = 'salvation';
      setTimeout(() => applyLayout('salvation'), 0);
    }
  }, true);

  window.addEventListener('duel:event', event => {
    const detail = event.detail;
    if (!['summon', 'revive'].includes(detail?.type)) return;
    setKindFromCode(detail.card?.code);
  });

  new MutationObserver(tryInstall).observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
}
