import { CARD_TYPES } from './game-engine.js';

export const CHARACTERS = {
  madoka: {
    id: 'madoka',
    name: '鹿目まどか',
    passive: '受ける戦闘ダメージを常に1軽減',
    special: 'プルウィア☆マギカ',
    image: './assets/characters/madoka.webp',
  },
  mami: {
    id: 'mami',
    name: '巴マミ',
    passive: '初期手札+1枚',
    special: 'ティロ・フィナーレ',
    image: './assets/characters/mami.webp',
  },
};

const MADOKA = './assets/cards/madoka/';
const MAMI = './assets/cards/mami/';

let serial = 0;
const uid = (prefix) => `${prefix}-${++serial}`;

function familiar({ code, name, attack, image }) {
  return {
    id: uid(code),
    code,
    name,
    type: CARD_TYPES.FAMILIAR,
    attack,
    rank: attack,
    image,
  };
}

function witch({ code, name, attack, image }) {
  return {
    id: uid(code),
    code,
    name,
    type: CARD_TYPES.WITCH,
    attack,
    tributeThreshold: attack,
    rank: attack,
    image,
  };
}

function boost(value, image) {
  return {
    id: uid(`boost-${value}`),
    code: `boost-${value}`,
    name: `こうげきアップ +${value}`,
    type: CARD_TYPES.MAGIC,
    chainable: true,
    effect: 'boost',
    value,
    image,
  };
}

function drawTwo(image) {
  return {
    id: uid('draw-2'),
    code: 'draw-2',
    name: 'しあわせのカップ',
    type: CARD_TYPES.MAGIC,
    chainable: false,
    effect: 'draw',
    value: 2,
    image,
  };
}

function shield(image) {
  return {
    id: uid('shield'),
    code: 'shield',
    name: 'まもりのたて',
    type: CARD_TYPES.MAGIC,
    chainable: true,
    effect: 'nullifyDamage',
    value: 0,
    image,
  };
}

function createMadokaFamiliars() {
  return [
    familiar({ code: 'familiar-cotton-3', name: '使い魔A', attack: 3, image: `${MADOKA}familiar_butterfly_3.png` }),
    familiar({ code: 'familiar-cotton-4', name: '使い魔A', attack: 4, image: `${MADOKA}familiar_butterfly_4.png` }),
    familiar({ code: 'familiar-cotton-5', name: '使い魔A', attack: 5, image: `${MADOKA}familiar_butterfly_5.png` }),
    familiar({ code: 'familiar-nurse-3', name: '使い魔B', attack: 3, image: `${MADOKA}familiar_butterfly_3.png` }),
    familiar({ code: 'familiar-nurse-4', name: '使い魔B', attack: 4, image: `${MADOKA}familiar_butterfly_4.png` }),
    familiar({ code: 'familiar-nurse-5', name: '使い魔B', attack: 5, image: `${MADOKA}familiar_butterfly_5.png` }),
    familiar({ code: 'familiar-vine-3', name: '使い魔C', attack: 3, image: `${MADOKA}familiar_legs_3.png` }),
    familiar({ code: 'familiar-vine-4', name: '使い魔C', attack: 4, image: `${MADOKA}familiar_legs_4.png` }),
    familiar({ code: 'familiar-vine-5', name: '使い魔C', attack: 5, image: `${MADOKA}familiar_legs_5.png` }),
    familiar({ code: 'familiar-legs-3', name: '使い魔D', attack: 3, image: `${MADOKA}familiar_legs_3.png` }),
    familiar({ code: 'familiar-legs-4', name: '使い魔D', attack: 4, image: `${MADOKA}familiar_legs_4.png` }),
    familiar({ code: 'familiar-legs-5', name: '使い魔D', attack: 5, image: `${MADOKA}familiar_legs_5.png` }),
  ];
}

function createMamiFamiliars() {
  return [
    familiar({ code: 'familiar-cotton-3', name: '使い魔A', attack: 3, image: `${MAMI}familiar_nurse_3.png` }),
    familiar({ code: 'familiar-cotton-4', name: '使い魔A', attack: 4, image: `${MAMI}familiar_nurse_4.png` }),
    familiar({ code: 'familiar-cotton-5', name: '使い魔A', attack: 5, image: `${MAMI}familiar_nurse_5.png` }),
    familiar({ code: 'familiar-nurse-3', name: '使い魔B', attack: 3, image: `${MAMI}familiar_nurse_3.png` }),
    familiar({ code: 'familiar-nurse-4', name: '使い魔B', attack: 4, image: `${MAMI}familiar_nurse_4.png` }),
    familiar({ code: 'familiar-nurse-5', name: '使い魔B', attack: 5, image: `${MAMI}familiar_nurse_5.png` }),
    familiar({ code: 'familiar-vine-3', name: '使い魔C', attack: 3, image: `${MAMI}familiar_vine_3.png` }),
    familiar({ code: 'familiar-vine-4', name: '使い魔C', attack: 4, image: `${MAMI}familiar_vine_4.png` }),
    familiar({ code: 'familiar-vine-5', name: '使い魔C', attack: 5, image: `${MAMI}familiar_vine_5.png` }),
    familiar({ code: 'familiar-legs-3', name: '使い魔D', attack: 3, image: `${MAMI}familiar_vine_3.png` }),
    familiar({ code: 'familiar-legs-4', name: '使い魔D', attack: 4, image: `${MAMI}familiar_vine_4.png` }),
    familiar({ code: 'familiar-legs-5', name: '使い魔D', attack: 5, image: `${MAMI}familiar_vine_5.png` }),
  ];
}

function createMadokaWitches() {
  return [
    witch({ code: 'witch-8-a', name: '8の魔女A', attack: 8, image: `${MADOKA}witch_rose_garden_8.png` }),
    witch({ code: 'witch-8-a', name: '8の魔女A', attack: 8, image: `${MADOKA}witch_rose_garden_8.png` }),
    witch({ code: 'witch-8-b', name: '8の魔女B', attack: 8, image: `${MADOKA}witch_class_representative_8.png` }),
    witch({ code: 'witch-8-b', name: '8の魔女B', attack: 8, image: `${MADOKA}witch_class_representative_8.png` }),
    witch({ code: 'witch-mermaid-a', name: '人魚の魔女', attack: 10, image: `${MADOKA}witch_mermaid_a_10.png` }),
    witch({ code: 'witch-mermaid-b', name: '人魚の魔女', attack: 10, image: `${MADOKA}witch_mermaid_b_10.png` }),
  ];
}

function createMamiWitches() {
  return [
    witch({ code: 'witch-8-a', name: '8の魔女A', attack: 8, image: `${MAMI}witch_shadow_8.png` }),
    witch({ code: 'witch-8-a', name: '8の魔女A', attack: 8, image: `${MAMI}witch_shadow_8.png` }),
    witch({ code: 'witch-8-b', name: '8の魔女B', attack: 8, image: `${MAMI}witch_shadow_8.png` }),
    witch({ code: 'witch-8-b', name: '8の魔女B', attack: 8, image: `${MAMI}witch_shadow_8.png` }),
    witch({ code: 'witch-mermaid-a', name: '人魚の魔女', attack: 10, image: `${MAMI}witch_candy_a_10.png` }),
    witch({ code: 'witch-mermaid-b', name: '人魚の魔女', attack: 10, image: `${MAMI}witch_candy_b_10.png` }),
  ];
}

function createMagicCards() {
  return [
    boost(2, `${MADOKA}magic_attack_up_2.png`), boost(2, `${MADOKA}magic_attack_up_2.png`), boost(2, `${MADOKA}magic_attack_up_2.png`),
    boost(3, `${MADOKA}magic_attack_up_3.png`), boost(3, `${MADOKA}magic_attack_up_3.png`), boost(3, `${MADOKA}magic_attack_up_3.png`),
    boost(5, `${MADOKA}magic_attack_up_5.png`),
    drawTwo(`${MADOKA}magic_draw_two.png`), drawTwo(`${MADOKA}magic_draw_two.png`),
    shield(`${MADOKA}magic_shield.png`), shield(`${MADOKA}magic_shield.png`), shield(`${MADOKA}magic_shield.png`),
  ];
}

// 30枚固定: 使い魔12 / 魔女6 / 魔法12。
// まどかとマミはカード性能と枚数を共通化し、モンスター画像だけ別スキンにする。
export function createMadokaDeck() {
  serial = 0;
  return [...createMadokaFamiliars(), ...createMadokaWitches(), ...createMagicCards()];
}

export function createMamiDeck() {
  serial = 0;
  return [...createMamiFamiliars(), ...createMamiWitches(), ...createMagicCards()];
}

export function createPrototypeDeck() {
  return createMadokaDeck();
}
