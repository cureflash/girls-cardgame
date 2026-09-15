const WALPURGIS_CODE = 'witch-walpurgis_13';
const SALVATION_CODE = 'witch-salvation_13';
const STORAGE_KEY = 'specialIntroAssetLayoutV1';

const WALPURGIS_IMAGE_SRC = './assets/special-intro/walpurgis.webp?v=special-intro3';
const SALVATION_CHUNK_URLS = Object.freeze([
  './assets/special-intro/salvation-art-0.b64?v=salvation-art3',
  './assets/special-intro/salvation-art-0b.b64?v=salvation-art3',
  './assets/special-intro/salvation-art-1.b64?v=salvation-art3',
  './assets/special-intro/salvation-art-2.b64?v=salvation-art3',
  './assets/special-intro/salvation-art-3.b64?v=salvation-art3',
  './assets/special-intro/salvation-art-4.b64?v=salvation-art3',
  './assets/special-intro/salvation-art-5a.b64?v=salvation-art3',
  './assets/special-intro/salvation-art-5b.b64?v=salvation-art3',
]);

const DEFAULTS = Object.freeze({
  walpurgis: Object.freeze({ x: 27, y: 50, scale: 78 }),
  salvation: Object.freeze({ x: 27, y: 50, scale: 82 }),
});

let layouts = loadLayouts();
let activeKind = 'walpurgis';
let salvationImageSrc = null;
let salvationImagePromise = null;

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

function ensureSalvationImage() {
  if (salvationImageSrc) return Promise.resolve(salvationImageSrc);
  if (salvationImagePromise) return salvationImagePromise;

  salvationImagePromise = Promise.all(
    SALVATION_CHUNK_URLS.map(async url => {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
      return (await response.text()).trim();
    }),
  ).then(parts => {
    salvationImageSrc = `data:image/webp;base64,${parts.join('')}`;
    return salvationImageSrc;
  }).catch(error => {
    console.warn('Failed to load Salvation Witch intro art', error);
    salvationImagePromise = null;
    return null;
  });

  return salvationImagePromise;
}

function applyLayout(kind = currentKind()) {
  const root = overlay();
  const enemy = root?.querySelector('.special-intro-enemy');
  if (!root || !enemy) return false;

  activeKind = kind === 'salvation' ? 'salvation' : 'walpurgis';
  const cfg = layouts[activeKind];

  enemy.style.left = `${cfg.x}%`;
  enemy.style.top = `${cfg.y}%`;
  enemy.style.transform = `translate(-50%,-50%) scale(${cfg.scale / 100}) rotate(-2deg)`;

  if (activeKind === 'salvation') {
    if (salvationImageSrc) {
      enemy.src = salvationImageSrc;
      enemy.style.visibility = '';
    } else {
      // Never expose the deck/card image while the clean summon art is loading.
      enemy.style.visibility = 'hidden';
      ensureSalvationImage().then(src => {
        if (!src || currentKind() !== 'salvation') return;
        enemy.src = src;
        enemy.style.visibility = '';
      });
    }
  } else {
    enemy.src = WALPURGIS_IMAGE_SRC;
    enemy.style.visibility = '';
  }

  syncControls();
  return true;
}

function setKindFromCode(code) {
  if (code === SALVATION_CODE) {
    activeKind = 'salvation';
    const enemy = overlay()?.querySelector('.special-intro-enemy');
    if (enemy && !salvationImageSrc) enemy.style.visibility = 'hidden';
    ensureSalvationImage().finally(() => setTimeout(() => applyLayout('salvation'), 0));
    return;
  }
  if (code === WALPURGIS_CODE) {
    activeKind = 'walpurgis';
    setTimeout(() => applyLayout('walpurgis'), 0);
  }
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
    if (out) out.value = `${Math.round(cfg[key])}%`;
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
      if (activeKind === 'salvation') {
        const enemy = root.querySelector('.special-intro-enemy');
        if (enemy && !salvationImageSrc) enemy.style.visibility = 'hidden';
        ensureSalvationImage().finally(() => setTimeout(() => applyLayout('salvation'), 0));
      } else {
        setTimeout(() => applyLayout('walpurgis'), 0);
      }
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-witch'] });
  applyLayout(root.dataset.witch === 'salvation' ? 'salvation' : 'walpurgis');
  return true;
}

function bootstrap() {
  // Preload the clean Salvation Witch art so preview/summon can switch without showing card art.
  ensureSalvationImage();

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
      const enemy = overlay()?.querySelector('.special-intro-enemy');
      if (enemy && !salvationImageSrc) enemy.style.visibility = 'hidden';
      ensureSalvationImage().finally(() => setTimeout(() => applyLayout('salvation'), 0));
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
