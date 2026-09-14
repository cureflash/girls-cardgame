# Five-character opening-hand rebalance results

This report records the five-character equal-search balance experiment after the requested opening-hand changes.

## Current rules under test

All five characters use the same mechanical 30-card deck. Printed witch tribute thresholds remain 8 / 10 / 13.

- Madoka: opening hand 5. Passive: battle damage -1. Special: revive one familiar/witch from graveyard; turn ends.
- Mami: opening hand 5. Passive: none. Special: Tiro Finale destroys all opposing familiars/witches; turn ends.
- Sayaka: opening hand 5. Passive: effective witch tribute requirement -3, so printed 8 / 10 / 13 are paid as 5 / 7 / 10. Special: return any 3 graveyard cards to the deck, shuffle the whole deck, then end the turn.
- Kyoko: opening hand 4 (opening hand -1). Special: once per duel at battle-start, use exactly one opposing familiar/witch as tribute toward summoning one witch from hand; pay any remaining requirement using normal own tributes; the special summon is additional to the normal summon and ends the turn.
- Homura: opening hand 8 (opening hand +3). Special: once per duel at battle-start, the opponent cannot chain for the rest of that turn; Homura continues into battle and may use her own boost magic.

Homura has no attack/tribute bonus. Mami no longer has her former +1 opening-hand passive.

## Validation

The opening-hand regression verifies actual starting hand sizes of:

- Madoka: 5
- Mami: 5
- Sayaka: 5
- Kyoko: 4
- Homura: 8

The standard CI also passed browser syntax, core regressions, WebP asset validation, the 300-duel regression, and GA smoke after the rule changes.

## Simulation configuration

- 100 games per matchup.
- All 10 pairings among 5 characters.
- 1,000 games total.
- 50 games in each seat arrangement per pairing.
- 4 hidden-world rollout samples per non-forced decision.
- Conservative rollout improvement threshold: 0.05.
- Maximum 300 actions.
- Same shared evaluation baseline and hidden-information rollout method for both players.
- 0 draws.
- 0 truncated games.
- 0 rollout cutoffs.

## Pairwise results

| Matchup | Result | First character win rate |
|---|---:|---:|
| Madoka vs Mami | 54 - 46 | Madoka 54% |
| Madoka vs Sayaka | 43 - 57 | Madoka 43% |
| Mami vs Sayaka | 43 - 57 | Mami 43% |
| Madoka vs Kyoko | 52 - 48 | Madoka 52% |
| Mami vs Kyoko | 63 - 37 | Mami 63% |
| Sayaka vs Kyoko | 48 - 52 | Sayaka 48% |
| Madoka vs Homura | 44 - 56 | Madoka 44% |
| Mami vs Homura | 45 - 55 | Mami 45% |
| Sayaka vs Homura | 51 - 49 | Sayaka 51% |
| Kyoko vs Homura | 59 - 41 | Kyoko 59% |

## Aggregate round robin

Each character played 400 games, 100 against each opponent.

| Rank | Character | Wins | Losses | Win rate |
|---:|---|---:|---:|---:|
| 1 | Sayaka | 213 | 187 | **53.25%** |
| 2 | Homura | 201 | 199 | **50.25%** |
| 3 | Mami | 197 | 203 | **49.25%** |
| 4 | Kyoko | 196 | 204 | **49.00%** |
| 5 | Madoka | 193 | 207 | **48.25%** |

The spread from first to fifth is only **5.00 percentage points**.

## Interpretation

The requested opening-hand changes substantially tighten the five-character field.

Homura's opening hand +3 is particularly effective: the previous no-passive / normal-opening-hand experiment produced only 32.00% aggregate, while the current eight-card opening gives Homura 201-199 (50.25%) across the same four opponents. Homura is now very close to neutral overall, although the matchups remain asymmetric: 56% vs Madoka, 55% vs Mami, 49% vs Sayaka, and 41% vs Kyoko.

Kyoko's opening hand -1 also meaningfully restrains the character. Kyoko is no longer the clear overall leader, finishing 49.00%, while retaining a favorable 59% matchup into Homura and a near-even 52% matchup into Sayaka. The largest weakness in this run is Mami, where Kyoko scores only 37%.

Removing Mami's former opening-hand +1 drops Mami toward the center of the field at 49.25%. Tiro Finale remains strong enough to create pronounced matchup advantages, most notably 63% against Kyoko, but Mami is no longer generally above the field.

Sayaka becomes the aggregate leader at 53.25%. The -3 tribute passive is strong enough to produce 57% against both Madoka and Mami, while Sayaka remains almost even against Kyoko (48%) and Homura (51%). This is an aggregate lead, not a universally dominant matchup profile.

Madoka finishes last at 48.25%, but this is not an underpowered result in the same sense as the former 32% Homura result. Madoka remains within five percentage points of the leader and has no catastrophic matchup in this sample; the worst is 43% against Sayaka.

Overall, by aggregate win rate this is the most tightly clustered tested five-character configuration so far. Pairwise matchup skew still exists, especially Mami-Kyoko (63-37) and Kyoko-Homura (59-41), but no character is globally far from 50%.
