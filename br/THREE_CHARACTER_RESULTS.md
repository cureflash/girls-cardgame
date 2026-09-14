# Three-character balance results

This report compares Madoka, Mami, and Sayaka under the same hidden-information rollout search capability after the corrected Sayaka rules.

## Shared deck rule

All three characters use mechanically identical 30-card decks:

- 13 familiars
- 7 witches
- 10 magic cards
- identical ATK distribution
- identical printed witch tribute thresholds: 8 / 10 / 13
- identical magic effects and counts

Only card names/art skins differ by character. Sayaka-specific names/art have not yet been supplied, so the analysis skin currently reuses Madoka's mapping; this does not change mechanical card contents.

## Sayaka rules implemented

- Passive: reduce the **effective** tribute requirement for witch summons by 1 as a character ability.
  - printed ATK 8 witch cost remains 8; Sayaka effectively needs 7
  - printed ATK 10 witch cost remains 10; Sayaka effectively needs 9
  - printed ATK 13 witch cost remains 13; Sayaka effectively needs 12
- Special: once per duel, at battle-phase start, choose any 3 cards in Sayaka's graveyard, return them to the deck, then shuffle the whole deck; the turn then ends.
- The special is legal only when at least 3 cards are in the graveyard.

## Validation

- Three-character mechanical deck equality regression: PASS
- Sayaka effective tribute discount regression: PASS
- Sayaka return-three-and-shuffle regression: PASS
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
| Madoka vs Sayaka | 53 - 47 | essentially even |
| Mami vs Sayaka | 65 - 35 | Mami clearly favored |

Seat detail:

- Madoka vs Mami: Madoka first 18/50, second 31/50; Mami first 19/50, second 32/50.
- Madoka vs Sayaka: Madoka first 24/50, second 29/50; Sayaka first 21/50, second 26/50.
- Mami vs Sayaka: Mami first 29/50, second 36/50; Sayaka first 14/50, second 21/50.

## Aggregate round robin

| Character | Wins | Losses | Win rate |
|---|---:|---:|---:|
| Mami | 116 | 84 | 58% |
| Madoka | 102 | 98 | 51% |
| Sayaka | 82 | 118 | 41% |

These aggregate percentages are matchup-weighted summaries; pairwise results are the more important balance signal.

## Special usage

- Madoka used Pluvia Magica 73 times vs Mami and 94 times vs Sayaka.
- Mami used Tiro Finale 55 times vs Madoka and 87 times vs Sayaka.
- Sayaka used her return-three-and-shuffle special 77 times vs Madoka and 58 times vs Mami.

## Change from the previous bottom-deck implementation

The old analysis returned the selected cards to the bottom without shuffling. After changing the rule to shuffle the entire deck:

- Sayaka vs Madoka changed from 51% to 47%.
- Sayaka vs Mami changed from 31% to 35%.
- Sayaka's aggregate result remained 82 / 200 = 41% in this sample.

The shuffle therefore changes matchup distribution but does not materially change Sayaka's overall placement in this 100-game-per-pair probe.

## Interpretation

Sayaka's passive is meaningful without changing the cards themselves: the common printed 8/10/13 costs stay identical across characters, while Sayaka receives a 7/9/12 effective requirement through her character ability.

Against Madoka, Sayaka remains close to even at 47%. Against Mami, Sayaka improves from the previous 31% to 35% but is still clearly disadvantaged. Tiro Finale directly punishes the board investment that Sayaka's cheaper tribute curve encourages, whereas Sayaka's special primarily extends deck life and randomizes future draws.

The current Sayaka design therefore remains viable but matchup-skewed: approximately even with Madoka and clearly weak to Mami. Any later balance adjustment should target that matchup interaction rather than changing the shared deck contents.
