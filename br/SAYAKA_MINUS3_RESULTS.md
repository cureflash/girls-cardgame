# Sayaka passive -3 balance results

This report evaluates Miki Sayaka after changing only her passive from an effective witch tribute requirement reduction of 1 to a reduction of 3.

## Rule under test

All characters continue to use mechanically identical 30-card decks. Printed witch tribute thresholds remain identical at 8 / 10 / 13.

Sayaka's character passive now reduces the effective tribute requirement by 3:

- printed 8 -> effective 5
- printed 10 -> effective 7
- printed 13 -> effective 10

The cards themselves are not modified. Sayaka's special remains unchanged: once per duel, choose any 3 cards in her graveyard, return them to the deck, shuffle the whole deck, and end the turn.

## Regression validation

On the tested code state:

- Browser app syntax: PASS
- Core regression tests: PASS
- WebP asset test: PASS
- 300-duel regression: PASS
- GA smoke: PASS
- Sayaka passive regression verifies that an ATK 8 witch can be summoned with one ATK 5 familiar while the card's printed tribute threshold remains 8.

## Focused 100-game matchup verification

Configuration:

- 100 games per Sayaka matchup
- 50 games in each seat arrangement
- 4 hidden-world rollout samples per non-forced decision
- conservative policy-improvement threshold: 0.05
- maximum 300 actions
- same evaluation baseline and rollout method for both players
- 0 draws
- 0 truncated games
- 0 rollout cutoffs

| Matchup | Result | Sayaka win rate |
|---|---:|---:|
| Madoka vs Sayaka | 46 - 54 | **54%** |
| Mami vs Sayaka | 57 - 43 | **43%** |
| Sayaka vs Kyoko | 39 - 61 | **39%** |

Across the three matchups, Sayaka finished **136 - 164**, for an aggregate win rate of **45.33%**.

### Seat detail

- vs Madoka: Sayaka first 23/50, second 31/50.
- vs Mami: Sayaka first 16/50, second 27/50.
- vs Kyoko: Sayaka first 20/50, second 19/50.

### Special usage

- vs Madoka: Sayaka used her special 75 times in 100 games.
- vs Mami: 65 times.
- vs Kyoko: 65 times.

## Comparison with the previous -1 passive

The previous four-character 100-game-per-pair, 8-sample rollout probe produced these Sayaka results:

- vs Madoka: 47%
- vs Mami: 36%
- vs Kyoko: 35%
- aggregate across those three matchups: 118 / 300 = 39.33%

The new -3 focused run produced:

- vs Madoka: 54% (**+7 percentage points**)
- vs Mami: 43% (**+7 percentage points**)
- vs Kyoko: 39% (**+4 percentage points**)
- aggregate: 45.33% (**+6 percentage points**)

The old comparison used 8 rollout samples while the focused -3 verification used 4, so the exact deltas should not be treated as a controlled causal estimate. The direction is nevertheless consistent with the separate 40-game -3 pilot, where Sayaka scored 50% vs Madoka, 35% vs Mami, and 45% vs Kyoko.

## Interpretation

Reducing the effective witch tribute requirement by 3 materially improves Sayaka without making her obviously dominant in this probe.

She becomes slightly favored over Madoka at 54%, but remains disadvantaged against Mami at 43% and Kyoko at 39%. This is substantially healthier than the previous -1 environment, where the four-character probe left Sayaka at 39.33% aggregate.

The current -3 setting therefore looks much closer to a viable balance point: Sayaka is no longer clearly the weakest by a large margin, but she still has identifiable bad matchups. A higher-search 8-sample full four-character run was also launched separately; this report uses the completed focused 100-game verification rather than waiting on that heavier run.
