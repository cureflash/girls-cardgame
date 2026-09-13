import { CARD_TYPES } from './game-engine.js';

export const CHARACTERS = {
  madoka: { id: 'madoka', name: '鹿目まどか', passive: '戦闘ダメージを1軽減', special: 'プルウィア☆マギカ', image: './assets/characters/madoka.webp' },
  mami: { id: 'mami', name: '巴マミ', passive: '初期手札が1枚多い', special: 'ティロ・フィナーレ', image: './assets/characters/mami.webp' },
};
const SKINS = {
  madoka: {
    familiars: [['butterfly', '薔薇園の魔女の使い魔'], ['legs', '委員長の魔女の使い魔']],
    witches: [['rose_garden_8', '薔薇園の魔女', 8, 2], ['class_representative_8', '委員長の魔女', 8, 2], ['mermaid_a_10', '人魚の魔女 A', 10, 1], ['mermaid_b_10', '人魚の魔女 B', 10, 1], ['salvation_13', '救済の魔女', 13, 1]],
  },
  mami: {
    familiars: [['nurse', 'お菓子の魔女の使い魔'], ['vine', '影の魔女の使い魔']],
    // 芸術家の魔女の原寸画像は次の画像コミットで差し替える。それまでは欠損を避けるため既存画像を使う。
    witches: [['shadow_8', '影の魔女', 8, 2], ['shadow_8', '芸術家の魔女', 8, 2], ['candy_a_10', 'お菓子の魔女 A', 10, 1], ['candy_b_10', 'お菓子の魔女 B', 10, 1], ['walpurgis_13', 'ワルプルギスの夜', 13, 1]],
  },
};

export function createDeck(characterId) {
  const skin = SKINS[characterId];
  if (!skin) throw new Error(`Unknown character: ${characterId}`);
  const cards = [];
  const add = (code, data, copies = 1) => {
    for (let n = 0; n < copies; n++) cards.push({ id: `${characterId}-${cards.length + 1}`, code, ...data });
  };
  const image = file => `./assets/cards/${characterId}/${file}.png?v=original1`;
  for (const [family, name] of skin.familiars) {
    for (const attack of [3, 4, 5]) add(`familiar-${family}-${attack}`, { name, type: CARD_TYPES.FAMILIAR, attack, rank: attack, image: image(`familiar_${family}_${attack}`) }, 2);
  }
  for (const [code, name, attack, copies] of skin.witches) add(`witch-${code}`, { name, type: CARD_TYPES.WITCH, attack, rank: attack, tributeThreshold: attack, image: image(`witch_${code}`) }, copies);
  const magic = (effect, name, value, file, copies, chainable) => add(`magic-${effect}-${value}`, { name, type: CARD_TYPES.MAGIC, effect, value, chainable, image: `./assets/cards/madoka/magic_${file}.png` }, copies);
  for (const [value, copies] of [[2, 3], [3, 3], [5, 1]]) magic('boost', `攻撃力＋${value}`, value, `attack_up_${value}`, copies, true);
  magic('draw', 'ドロー魔法', 2, 'draw_two', 1, false);
  magic('nullifyDamage', '盾', 0, 'shield', 3, true);
  return cards; // 30 = familiars 12 + witches 7 + magic 11
}
export const createMadokaDeck = () => createDeck('madoka');
export const createMamiDeck = () => createDeck('mami');
export const createPrototypeDeck = createMadokaDeck;
