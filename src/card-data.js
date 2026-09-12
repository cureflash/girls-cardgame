import { CARD_TYPES } from './game-engine.js';

export const CHARACTERS = {
  madoka: {
    id: 'madoka',
    name: '鹿目まどか',
    passive: '受ける戦闘ダメージを常に1軽減',
    special: 'プルウィア☆マギカ',
    image: './assets/characters/madoka.png',
  },
  mami: {
    id: 'mami',
    name: '巴マミ',
    passive: '初期手札+1枚',
    special: 'ティロ・フィナーレ',
    image: './assets/characters/mami.png',
  },
};

let serial = 0;
const uid = (prefix) => `${prefix}-${++serial}`;

function familiar(rank, suit) {
  return {
    id: uid(`${suit}${rank}`),
    name: `${suit}${rank} 使い魔`,
    type: CARD_TYPES.FAMILIAR,
    attack: rank,
    rank,
    suit,
    image: `./assets/cards/${suit}_${rank}.png`,
  };
}

function witch(rank, suit) {
  return {
    id: uid(`${suit}${rank}`),
    name: `${suit}${rank} 魔女`,
    type: CARD_TYPES.WITCH,
    attack: rank,
    tributeThreshold: rank,
    rank,
    suit,
    image: `./assets/cards/${suit}_${rank}.png`,
  };
}

function boost(value, suit = '♠') {
  return {
    id: uid(`${suit}M${value}`),
    name: `${suit}${value} 攻撃魔法`,
    type: CARD_TYPES.MAGIC,
    chainable: true,
    effect: 'boost',
    value,
    rank: value,
    suit,
    image: `./assets/cards/${suit}_${value}.png`,
  };
}

function ace(suit = 'A') {
  return {
    id: uid(`${suit}A`),
    name: `${suit}A 防御魔法`,
    type: CARD_TYPES.MAGIC,
    chainable: true,
    effect: 'nullifyDamage',
    value: 0,
    rank: 1,
    suit,
    image: `./assets/cards/${suit}_A.png`,
  };
}

// 試作用カードプール。正式なカード割当はこのファイルだけ差し替えればよい。
export function createPrototypeDeck() {
  serial = 0;
  const deck = [];
  for (const suit of ['♦', '♣']) {
    for (let n = 2; n <= 8; n++) deck.push(familiar(n, suit));
    for (let n = 9; n <= 13; n++) deck.push(witch(n, suit));
  }
  for (let n = 2; n <= 13; n++) deck.push(boost(n, '♠'));
  for (let i = 0; i < 4; i++) deck.push(ace('♥'));
  return deck;
}
