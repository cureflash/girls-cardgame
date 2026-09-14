import { CARD_TYPES } from './game-engine.js';

export const CHARACTERS = {
  madoka: { id: 'madoka', name: '鹿目まどか', passive: '戦闘ダメージを1軽減', special: 'プルウィア☆マギカ', image: './assets/characters/madoka.webp' },
  mami: { id: 'mami', name: '巴マミ', passive: '初期手札が1枚多い', special: 'ティロ・フィナーレ', image: './assets/characters/mami.webp' },
  sayaka: { id: 'sayaka', name: '美樹さやか', passive: '魔女召喚の生贄に必要な攻撃力合計を1減らす', special: '墓地の任意のカード3枚をデッキに戻してシャッフル', image: null },
};
const SKINS = {
  madoka: {
    familiars: [['butterfly', '薔薇園の魔女の使い魔'], ['legs', '委員長の魔女の使い魔']],
    witches: [['rose_garden_8', '薔薇園の魔女', 8, 2], ['class_representative_8', '委員長の魔女', 8, 2], ['mermaid_a_10', '人魚の魔女 A', 10, 1], ['mermaid_b_10', '人魚の魔女 B', 10, 1], ['salvation_13', '救済の魔女', 13, 1]],
  },
  mami: {
    familiars: [['nurse', 'お菓子の魔女の使い魔'], ['vine', '影の魔女の使い魔']],
    witches: [['shadow_8', '影の魔女', 8, 2], ['artist_8', '芸術家の魔女', 8, 2], ['candy_a_10', 'お菓子の魔女 A', 10, 1], ['candy_b_10', 'お菓子の魔女 B', 10, 1], ['walpurgis_13', 'ワルプルギスの夜', 13, 1]],
  },
  // All characters use the same mechanical 30-card structure. Sayaka-specific names/art
  // have not been supplied yet, so the analysis skin temporarily reuses Madoka's mapping.
  sayaka: {
    assetCharacter: 'madoka',
    familiars: [['butterfly', '薔薇園の魔女の使い魔'], ['legs', '委員長の魔女の使い魔']],
    witches: [['rose_garden_8', '薔薇園の魔女', 8, 2], ['class_representative_8', '委員長の魔女', 8, 2], ['mermaid_a_10', '人魚の魔女 A', 10, 1], ['mermaid_b_10', '人魚の魔女 B', 10, 1], ['salvation_13', '救済の魔女', 13, 1]],
  },
};

export function createDeck(characterId) {
  const skin = SKINS[characterId];
  if (!skin) throw new Error(`Unknown character: ${characterId}`);
  const cards = [];
  const add = (code, data, copies = 1) => {
    for (let n = 0; n < copies; n++) cards.push({ id: `${characterId}-${cards.length + 1}`, code, ...data });
  };
  const assetCharacter = skin.assetCharacter ?? characterId;
  const image = file => `./assets/cards/${assetCharacter}/${file}.webp?v=cards-webp1`;
  skin.familiars.forEach(([family, name], familyIndex) => {
    for (const attack of [3, 4, 5]) {
      const copies = attack === 3 && familyIndex === 0 ? 3 : 2;
      add(`familiar-${family}-${attack}`, { name, type: CARD_TYPES.FAMILIAR, attack, rank: attack, image: image(`familiar_${family}_${attack}`) }, copies);
    }
  });
  for (const [code, name, attack, copies] of skin.witches) {
    add(`witch-${code}`, { name, type: CARD_TYPES.WITCH, attack, rank: attack, tributeThreshold: attack, image: image(`witch_${code}`) }, copies);
  }
  const magic = (effect, name, value, file, copies, chainable) => add(`magic-${effect}-${value}`, { name, type: CARD_TYPES.MAGIC, effect, value, chainable, image: `./assets/cards/madoka/magic_${file}.webp?v=cards-webp1` }, copies);
  for (const [value, copies] of [[2, 3], [3, 3], [5, 1]]) magic('boost', `攻撃力＋${value}`, value, `attack_up_${value}`, copies, true);
  magic('nullifyDamage', '盾', 0, 'shield', 3, true);
  return cards; // 30 = familiars 13 + witches 7 + magic 10
}
export const createMadokaDeck = () => createDeck('madoka');
export const createMamiDeck = () => createDeck('mami');
export const createSayakaDeck = () => createDeck('sayaka');
export const createPrototypeDeck = createMadokaDeck;
