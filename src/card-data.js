import { CARD_TYPES } from './game-engine.js';

export const CHARACTERS = {
  madoka: { id: 'madoka', name: '鹿目まどか', passive: '戦闘ダメージを1軽減', openingHandModifier: 0, special: 'プルウィア☆マギカ', image: './assets/characters/madoka.webp' },
  mami: { id: 'mami', name: '巴マミ', passive: '初期手札が1枚少ない', openingHandModifier: -1, special: 'ティロ・フィナーレ', image: './assets/characters/mami.webp' },
  sayaka: { id: 'sayaka', name: '美樹さやか', passive: '魔女召喚の生贄に必要な攻撃力合計を3減らす', openingHandModifier: 0, special: '墓地の任意のカード3枚をデッキに戻してシャッフル', image: './assets/characters/sayaka.webp' },
  kyoko: { id: 'kyoko', name: '佐倉杏子', passive: 'なし', openingHandModifier: 0, special: '相手の使い魔・魔女1体を生贄にして魔女召喚', image: './assets/characters/kyoko.webp' },
  homura: { id: 'homura', name: '暁美ほむら', passive: '自分のターンに最初に使う攻撃力アップ1枚の上昇値を+2', openingHandModifier: 1, special: '戦闘前に手札の魔女1体を生贄なしで追加召喚可能＋発動ターン中、相手はチェーン不可', image: './assets/characters/homura.webp' },
  nagisa: { id: 'nagisa', name: '百江なぎさ', passive: '自分の使い魔が戦闘で破壊される場合、1ターンに1度だけ手札に戻す', openingHandModifier: 0, special: '強制戦闘', image: './assets/characters/nagisa.webp' },
};

const SKINS = {
  madoka: {
    assetCharacter: 'madoka',
    familiars: [['butterfly', '薔薇園の魔女の使い魔'], ['legs', '委員長の魔女の使い魔']],
    witches: [['rose_garden_8', '薔薇園の魔女', 8, 2], ['class_representative_8', '委員長の魔女', 8, 2], ['mermaid_a_10', '人魚の魔女 A', 10, 1], ['mermaid_b_10', '人魚の魔女 B', 10, 1], ['salvation_13', '救済の魔女', 13, 1]],
  },
  mami: {
    assetCharacter: 'mami',
    familiars: [['nurse', 'お菓子の魔女の使い魔'], ['vine', '影の魔女の使い魔']],
    witches: [['shadow_8', '影の魔女', 8, 2], ['artist_8', '芸術家の魔女', 8, 2], ['candy_a_10', 'お菓子の魔女 A', 10, 1], ['candy_b_10', 'お菓子の魔女 B', 10, 1], ['walpurgis_13', 'ワルプルギスの夜', 13, 1]],
  },
  // Analysis defaults retain character-keyed skins for backward compatibility.
  sayaka: {
    assetCharacter: 'madoka',
    familiars: [['butterfly', '薔薇園の魔女の使い魔'], ['legs', '委員長の魔女の使い魔']],
    witches: [['rose_garden_8', '薔薇園の魔女', 8, 2], ['class_representative_8', '委員長の魔女', 8, 2], ['mermaid_a_10', '人魚の魔女 A', 10, 1], ['mermaid_b_10', '人魚の魔女 B', 10, 1], ['salvation_13', '救済の魔女', 13, 1]],
  },
  kyoko: {
    assetCharacter: 'madoka',
    familiars: [['butterfly', '薔薇園の魔女の使い魔'], ['legs', '委員長の魔女の使い魔']],
    witches: [['rose_garden_8', '薔薇園の魔女', 8, 2], ['class_representative_8', '委員長の魔女', 8, 2], ['mermaid_a_10', '人魚の魔女 A', 10, 1], ['mermaid_b_10', '人魚の魔女 B', 10, 1], ['salvation_13', '救済の魔女', 13, 1]],
  },
  homura: {
    assetCharacter: 'madoka',
    familiars: [['butterfly', '薔薇園の魔女の使い魔'], ['legs', '委員長の魔女の使い魔']],
    witches: [['rose_garden_8', '薔薇園の魔女', 8, 2], ['class_representative_8', '委員長の魔女', 8, 2], ['mermaid_a_10', '人魚の魔女 A', 10, 1], ['mermaid_b_10', '人魚の魔女 B', 10, 1], ['salvation_13', '救済の魔女', 13, 1]],
  },
  nagisa: {
    assetCharacter: 'madoka',
    familiars: [['butterfly', '薔薇園の魔女の使い魔'], ['legs', '委員長の魔女の使い魔']],
    witches: [['rose_garden_8', '薔薇園の魔女', 8, 2], ['class_representative_8', '委員長の魔女', 8, 2], ['mermaid_a_10', '人魚の魔女 A', 10, 1], ['mermaid_b_10', '人魚の魔女 B', 10, 1], ['salvation_13', '救済の魔女', 13, 1]],
  },
};

export function createDeck(characterId, skinId = characterId, idPrefix = characterId) {
  if (!CHARACTERS[characterId]) throw new Error(`Unknown character: ${characterId}`);
  // Keep createDeck safe as an Array.map callback: map passes numeric index/array as extra args.
  const resolvedSkinId = typeof skinId === 'string' ? skinId : characterId;
  const resolvedIdPrefix = typeof idPrefix === 'string' ? idPrefix : characterId;
  const skin = SKINS[resolvedSkinId];
  if (!skin) throw new Error(`Unknown deck skin: ${resolvedSkinId}`);
  const cards = [];
  const add = (code, data, copies = 1) => {
    for (let n = 0; n < copies; n++) cards.push({ id: `${resolvedIdPrefix}-${cards.length + 1}`, code, ...data });
  };
  const assetCharacter = skin.assetCharacter ?? resolvedSkinId;
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
  // Magic cards are shared across both visual decks; only one common art set exists.
  const magic = (effect, name, value, file, copies, chainable) => add(`magic-${effect}-${value}`, { name, type: CARD_TYPES.MAGIC, effect, value, chainable, image: `./assets/cards/madoka/magic_${file}.webp?v=cards-webp1` }, copies);
  for (const [value, copies] of [[2, 3], [3, 3], [5, 1]]) magic('boost', `攻撃力＋${value}`, value, `attack_up_${value}`, copies, true);
  magic('nullifyDamage', '盾', 0, 'shield', 3, true);
  return cards; // 30 = familiars 13 + witches 7 + magic 10
}

export const createPlayerDeck = characterId => createDeck(characterId, 'madoka', `player-${characterId}`);
export const createNpcDeck = characterId => createDeck(characterId, 'mami', `npc-${characterId}`);
export const createMadokaDeck = () => createDeck('madoka');
export const createMamiDeck = () => createDeck('mami');
export const createSayakaDeck = () => createDeck('sayaka');
export const createKyokoDeck = () => createDeck('kyoko');
export const createHomuraDeck = () => createDeck('homura');
export const createNagisaDeck = () => createDeck('nagisa');
export const createPrototypeDeck = createMadokaDeck;