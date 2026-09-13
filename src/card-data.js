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

const MADOKA_SPRITE = './assets/cards/madoka/cards.webp';

let serial = 0;
const uid = (prefix) => `${prefix}-${++serial}`;
const art = (spriteIndex) => ({ image: MADOKA_SPRITE, spriteIndex });

function familiar({ code, name, attack, spriteIndex }) {
  return {
    id: uid(code),
    code,
    name,
    type: CARD_TYPES.FAMILIAR,
    attack,
    rank: attack,
    ...art(spriteIndex),
  };
}

function witch({ code, name, attack, spriteIndex }) {
  return {
    id: uid(code),
    code,
    name,
    type: CARD_TYPES.WITCH,
    attack,
    tributeThreshold: attack,
    rank: attack,
    ...art(spriteIndex),
  };
}

function boost(value, spriteIndex) {
  return {
    id: uid(`boost-${value}`),
    code: `boost-${value}`,
    name: `こうげきアップ +${value}`,
    type: CARD_TYPES.MAGIC,
    chainable: true,
    effect: 'boost',
    value,
    ...art(spriteIndex),
  };
}

function drawTwo() {
  return {
    id: uid('draw-2'),
    code: 'draw-2',
    name: 'しあわせのカップ',
    type: CARD_TYPES.MAGIC,
    chainable: false,
    effect: 'draw',
    value: 2,
    ...art(19),
  };
}

function shield() {
  return {
    id: uid('shield'),
    code: 'shield',
    name: 'まもりのたて',
    type: CARD_TYPES.MAGIC,
    chainable: true,
    effect: 'nullifyDamage',
    value: 0,
    ...art(20),
  };
}

const FAMILIARS = [
  ['cotton', '使い魔A', 3, 0],
  ['cotton', '使い魔A', 4, 1],
  ['cotton', '使い魔A', 5, 2],
  ['nurse', '使い魔B', 3, 3],
  ['nurse', '使い魔B', 4, 4],
  ['nurse', '使い魔B', 5, 5],
  ['vine', '使い魔C', 3, 6],
  ['vine', '使い魔C', 4, 7],
  ['vine', '使い魔C', 5, 8],
  ['legs', '使い魔D', 3, 9],
  ['legs', '使い魔D', 4, 10],
  ['legs', '使い魔D', 5, 11],
];

function createFamiliars() {
  return FAMILIARS.map(([family, name, attack, spriteIndex]) => familiar({
    code: `familiar-${family}-${attack}`,
    name,
    attack,
    spriteIndex,
  }));
}

function createWitches() {
  return [
    witch({ code: 'witch-8-a', name: '8の魔女A', attack: 8, spriteIndex: 12 }),
    witch({ code: 'witch-8-a', name: '8の魔女A', attack: 8, spriteIndex: 12 }),
    witch({ code: 'witch-8-b', name: '8の魔女B', attack: 8, spriteIndex: 13 }),
    witch({ code: 'witch-8-b', name: '8の魔女B', attack: 8, spriteIndex: 13 }),
    witch({ code: 'witch-mermaid-a', name: '人魚の魔女', attack: 10, spriteIndex: 14 }),
    witch({ code: 'witch-mermaid-b', name: '人魚の魔女', attack: 10, spriteIndex: 15 }),
  ];
}

function createMagicCards() {
  return [
    boost(2, 16), boost(2, 16), boost(2, 16),
    boost(3, 17), boost(3, 17), boost(3, 17),
    boost(5, 18),
    drawTwo(), drawTwo(),
    shield(), shield(), shield(),
  ];
}

// 30枚固定: 使い魔12 / 魔女6 / 魔法12。
// まどかとマミは同一のカード構成を使い、画像スキンのみ別管理する想定。
export function createMadokaDeck() {
  serial = 0;
  return [...createFamiliars(), ...createWitches(), ...createMagicCards()];
}

export function createMamiDeck() {
  return createMadokaDeck().map(card => ({ ...card, image: null, spriteIndex: null }));
}

export function createPrototypeDeck() {
  return createMadokaDeck();
}
