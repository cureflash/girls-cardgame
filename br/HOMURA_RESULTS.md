# Homura balance results

This report evaluates Akemi Homura in the analysis/AI engine after removing her passive ability and leaving only the requested chain-lock special.

## Current Homura rules

- Passive: none.
- Special: once per duel at battle-phase start, the opponent cannot chain for the remainder of that turn.
- Homura's special does not skip the battle phase and does not end the turn.
- Homura can still chain her own boost magic after activating the special.
- The opponent cannot respond with boost magic or Shield while the special's chain lock is active.
- All five characters use mechanically identical 30-card decks. Homura-specific names/art have not been supplied, so the analysis skin currently reuses Madoka's card names/art.

## Regression validation

PASS:

- Homura has no passive attack bonus: a printed ATK 3 familiar remains effective ATK 3 in battle.
- Homura has no passive tribute bonus: two printed ATK 3 familiars provide only 6 tribute power and cannot summon a printed ATK 8 witch by themselves.
- Printed card attack and printed witch tribute thresholds remain unchanged.
- After Homura activates her special, the battle phase remains available on the same turn.
- Homura can use her own +2 boost during that battle.
- An opponent holding Shield cannot chain it during the locked turn.
- The regression example resolves Homura's printed ATK 3 familiar as 3 + boost 2 = ATK 5 against an opposing ATK 3 familiar.
- Existing browser syntax, core regression tests, WebP asset test, 300-duel regression, and GA smoke all passed after removing the passive.

## Full focused balance verification — no passive

Configuration:

- 100 games per Homura matchup.
- 50 games in each seat arrangement.
- 4 hidden-world rollout samples per non-forced decision.
- Conservative rollout improvement threshold: 0.05.
- Maximum 300 actions.
- Same shared evaluation baseline and hidden-information rollout method for both players.
- Sayaka uses the current -3 effective witch tribute rule.
- 0 draws.
- 0 truncated games.
- 0 rollout cutoffs.

| Matchup | Result | Homura win rate |
|---|---:|---:|
| Madoka vs Homura | 58 - 42 | **42%** |
| Mami vs Homura | 73 - 27 | **27%** |
| Sayaka vs Homura | 66 - 34 | **34%** |
| Kyoko vs Homura | 75 - 25 | **25%** |

Across the four matchups, Homura finished **128 - 272**, for an aggregate win rate of **32.00%**.

### Seat detail

- vs Madoka: Homura first 20/50, second 22/50.
- vs Mami: Homura first 15/50, second 12/50.
- vs Sayaka: Homura first 13/50, second 21/50.
- vs Kyoko: Homura first 11/50, second 14/50.

The weakness is present from both seats rather than being explained by one seat arrangement.

### Special usage

- vs Madoka: Homura special used 51 times / 100 games.
- vs Mami: 60 / 100.
- vs Sayaka: 57 / 100.
- vs Kyoko: 45 / 100.

The equal-search AI still selected the special situationally, but the special alone was not enough to keep Homura near 50% against Mami, Sayaka, or Kyoko.

## Comparison with the removed ATK +1 passive

The previous otherwise-equivalent focused run used the same 100 games per matchup, 50/50 seat split, 4 rollout samples, 0.05 improvement threshold, and 300-action cap, but Homura also had a permanent effective ATK +1 to all familiars and witches, including tribute value.

| Matchup | With ATK +1 passive | No passive | Change |
|---|---:|---:|---:|
| vs Madoka | 67% | 42% | **-25 pp** |
| vs Mami | 60% | 27% | **-33 pp** |
| vs Sayaka | 65% | 34% | **-31 pp** |
| vs Kyoko | 53% | 25% | **-28 pp** |
| Aggregate | 61.25% | 32.00% | **-29.25 pp** |

This is a large reversal. The prior version was likely overtuned; the no-passive version is now clearly underpowered in this tested environment.

The comparison does not mean the removed passive is worth exactly 29.25 percentage points in isolation, because the passive and special interact and the rollout policy adapts to the changed game states. It does show that removing the passive, with the rest of the tested setup held constant, dramatically reduced Homura's performance.

## Interpretation

With no passive ability, Homura's once-per-duel chain lock is not sufficient compensation for having no always-on advantage. It can create one strong attack turn by denying Shield and opposing boosts while still allowing Homura's own boosts, but outside that turn Homura plays the shared deck with no numerical or resource advantage.

The current no-passive result is **32.00% aggregate**, with the least unfavorable matchup being Madoka at 42%. Mami, Sayaka, and Kyoko all beat Homura by large margins in this run.

Therefore the current version is substantially weaker than the tested field. If the design goal is approximately even character balance, the data indicate that the former permanent ATK +1 was too strong, while removing the passive entirely is too large a nerf.
