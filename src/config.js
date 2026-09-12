export const RULES = {
  // 記憶に残っていない部分は暫定値。ここだけ変えれば調整できる。
  baseInitialHand: 5,
  fieldLimit: 5,
  jokerCount: 1,
  attacksPerTurn: 1,
  madokaDamageReduction: 1,
  mamiInitialHandBonus: 1,
  aiAceThreshold: 4,
};

export const CHARACTERS = {
  madoka: {
    id: 'madoka',
    name: '鹿目まどか',
    ability: '受ける戦闘ダメージを常に1軽減',
  },
  mami: {
    id: 'mami',
    name: '巴マミ',
    ability: '初期手札+1枚',
  },
};
