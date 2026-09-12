const SUITS = [
  ['S', '♠', 'スペード'],
  ['H', '♥', 'ハート'],
  ['D', '♦', 'ダイヤ'],
  ['C', '♣', 'クラブ'],
];

const RANKS = [
  ['A', 1],
  ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10],
  ['J', 11], ['Q', 12], ['K', 13],
];

export function createDeck(jokerCount = 1) {
  const cards = [];
  for (const [suit, symbol, suitName] of SUITS) {
    for (const [rank, value] of RANKS) {
      cards.push({
        id: `${suit}${rank}`,
        code: `${suit}${rank}`,
        suit,
        suitSymbol: symbol,
        suitName,
        rank,
        value,
        kind: rank === 'A' ? 'ace' : 'familiar',
      });
    }
  }
  for (let i = 0; i < jokerCount; i += 1) {
    cards.push({
      id: `JOKER${i + 1}`,
      code: 'JOKER',
      suit: null,
      suitSymbol: '★',
      suitName: 'ジョーカー',
      rank: 'JOKER',
      value: 0,
      kind: 'joker',
    });
  }
  return cards;
}

export function shuffle(cards, rng = Math.random) {
  const copy = cards.map((card) => ({ ...card }));
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function tributeCost(card) {
  if (!card || card.kind !== 'familiar') return null;
  if (card.value >= 11) return 2;
  if (card.value >= 9) return 1;
  return 0;
}

export function canBeSummoned(card) {
  return card?.kind === 'familiar';
}

export function isSpadeBoost(card) {
  return card?.suit === 'S' && card.kind === 'familiar';
}

export function isHeartRitual(card) {
  return card?.suit === 'H' && card.kind === 'familiar';
}

export function label(card) {
  if (!card) return '';
  if (card.kind === 'joker') return 'JOKER';
  return `${card.suitSymbol}${card.rank}`;
}
