# Three-character balance results

This report adds Miki Sayaka to the analysis rules and compares Madoka, Mami, and Sayaka under the same hidden-information rollout search capability.

## Sayaka rules implemented

- Passive: reduce the tribute threshold required to summon a witch by 1.
  - ATK 8 witch: 8 -> 7
  - ATK 10 witch: 10 -> 9
  - ATK 13 witch: 13 -> 12
- Special: once per duel, at battle-phase start, choose any 3 cards in Sayaka's graveyard and return them to the bottom of the deck in the chosen order; the turn then ends.
- The special is legal only when at least 3 cards are in the graveyard.

The user specified only that the cards return to the deck, not where in the deck. For this analysis implementation they return to the bottom rather than shuffling, so the special grants exactly +3 deck life without introducing extra draw-order variance.

## Deck condition

Sayaka currently uses a mirrored copy of Madoka's numerical 30-card pool for the balance study. This deliberately isolates character-ability strength: 13 familiars, 7 witches, and 10 magic cards, with the same 8/10/13 witch tiers. Sayaka-specific card names/art have not yet been designed.

## Validation

- Sayaka passive regression: PASS
- Sayaka special regression: PASS
- Browser syntax: PASS
- Core regression tests: PASS
- WebP asset test: PASS
- 300-duel regression: PASS
- GA smoke: PASS
- Mutual-rollout run: PASS
- truncated games: 0
- rollout cutoffs: 0

## Equal-search pairwise results

Configuration:

- 100 games per pair
- 50 games in each seat arrangement
- 8 hidden-world rollout samples per non-forced decision
- conservative policy improvement threshold: 0.05
- maximum 300 actions
- same baseline evaluation policy and same rollout method for all three characters

| Matchup | Wins | Result |
|---|---:|---:|
| Madoka vs Mami | 49 - 51 | essentially even |
| Madoka vs Sayaka | 49 - 51 | essentially even |
| Mami vs Sayaka | 69 - 31 | Mami clearly favored |

Seat detail:

- Madoka vs Mami: Madoka first 18/50, second 31/50; Mami first 19/50, second 32/50.
- Madoka vs Sayaka: Madoka first 22/50, second 27/50; Sayaka first 23/50, second 28/50.
- Mami vs Sayaka: Mami first 31/50, second 38/50; Sayaka first 12/50, second 19/50.

## Aggregate round robin

| Character | Wins | Losses | Win rate |
|---|---:|---:|---:|
| Mami | 120 | 80 | 60% |
| Madoka | 98 | 102 | 49% |
| Sayaka | 82 | 118 | 41% |

These aggregate percentages are not a single symmetric matchup rating; each character plays two different opponents. Pairwise results are the more important balance signal.

## Special usage

- Madoka used Pluvia Magica 73 times vs Mami and 93 times vs Sayaka.
- Mami used Tiro Finale 55 times vs Madoka and 90 times vs Sayaka.
- Sayaka used her three-card recycle 77 times vs Madoka and 66 times vs Mami.

## Interpretation

Sayaka's passive is meaningful: lowering 8/10/13 tribute thresholds to 7/9/12 gives her a real tempo/resource advantage, and together with the +3-deck-life special it is enough to produce an even 51/49 result against Madoka under equal search.

The Mami matchup is different. Mami's Tiro Finale directly punishes board investment, while Sayaka's advantages primarily make it cheaper to build that board and extend her deck life. In the equal-search sample, that interaction leaves Sayaka substantially disadvantaged at 31% against Mami.

The current Sayaka design therefore appears viable but matchup-skewed rather than generally underpowered: approximately even with Madoka, clearly weak to Mami. A future balance pass should target the Mami matchup specifically rather than simply buffing Sayaka across the board.
