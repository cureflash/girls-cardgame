# Homura balance results

This report evaluates Akemi Homura after implementing the requested character abilities in the analysis/AI engine.

## Implemented Homura rules

- Passive: all of Homura's familiars and witches have effective ATK +1.
- The +1 is used for battle power and tribute value; printed card ATK remains unchanged.
- Special: once per duel at battle-phase start, the opponent cannot chain for the remainder of that turn.
- Homura's special does not skip the battle phase and does not end the turn.
- Homura can still chain her own boost magic after activating the special.
- The opponent cannot respond with boost magic or Shield while the special's chain lock is active.
- All five characters use mechanically identical 30-card decks. Homura-specific names/art have not been supplied, so the analysis skin currently reuses Madoka's card names/art.

## Regression validation

PASS:

- Homura printed ATK 3 familiar battles as effective ATK 4, then remains printed ATK 3 afterward.
- Two printed ATK 3 Homura familiars count as effective tribute power 8 and can summon a printed ATK 8 witch.
- Printed card attack and printed witch tribute thresholds are not permanently modified.
- After Homura activates her special, the battle phase remains available on the same turn.
- Homura can use her own +2 boost during that battle.
- An opponent holding Shield cannot chain it during the locked turn.
- Example regression resolves Homura's printed ATK 3 familiar as 3 + passive 1 + boost 2 = ATK 6 against an opposing ATK 3 familiar.
- Existing browser syntax, core regression tests, WebP asset test, 300-duel regression, and GA smoke all passed on the Homura implementation.

## Full focused balance verification

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
| Madoka vs Homura | 33 - 67 | **67%** |
| Mami vs Homura | 40 - 60 | **60%** |
| Sayaka vs Homura | 35 - 65 | **65%** |
| Kyoko vs Homura | 47 - 53 | **53%** |

Across the four matchups, Homura finished **245 - 155**, for an aggregate win rate of **61.25%**.

### Seat detail

- vs Madoka: Homura first 32/50, second 35/50.
- vs Mami: Homura first 30/50, second 30/50.
- vs Sayaka: Homura first 32/50, second 33/50.
- vs Kyoko: Homura first 27/50, second 26/50.

The result is not explained by seat advantage; Homura performed similarly from both seats in all four matchups.

### Special usage

- vs Madoka: Homura special used 46 times / 100 games.
- vs Mami: 52 / 100.
- vs Sayaka: 60 / 100.
- vs Kyoko: 43 / 100.

The equal-search AI therefore did not simply fire the special whenever it became available. It used the special in roughly half of games and selected it as a situational tactical action.

## Pilot cross-check

A separate faster probe using 40 games per matchup and 2 rollout samples produced:

- vs Madoka: 70%.
- vs Mami: 55%.
- vs Sayaka: 67.5%.
- vs Kyoko: 62.5%.
- aggregate: 102 / 160 = 63.75%.

The pilot and the full run agree on the main direction: Homura is substantially above 50% overall, with especially strong results against Madoka and Sayaka. The full run reduces the apparent Kyoko advantage to near-even at 53%.

## Interpretation

Under the requested rules, Homura is currently a top-tier / likely overtuned character in the tested five-character environment.

The strongest current evidence is the full 400-game focused result: 61.25% aggregate, with 67% versus Madoka, 60% versus Mami, 65% versus Sayaka, and only Kyoko remaining approximately even at 53%.

The passive is always active and improves both combat breakpoints and tribute efficiency. The special then creates one turn where defensive Shield and opposing boosts cannot answer Homura's attack, while Homura can still stack her own boosts and continue the battle phase. These effects reinforce each other rather than covering separate weaknesses.

This simulation does not isolate the passive and special separately, so it cannot by itself determine which component contributes more to the excess win rate. An ablation run would be required to measure passive-only and special-only strength independently.
