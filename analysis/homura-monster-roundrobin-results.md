# Homura extra-monster AI retrain and round robin

Product rules/policies used by this tournament come from `feature/nagisa` at `52f74ac8e21cd81328cff87812057cbafae1f859`.

Current Homura rules in this run:

- Opening hand: 6 cards (`+1`).
- The previous passive that added `+2` to the first attack-up card each turn is removed.
- Special: before battle, Homura may additionally summon one monster from hand (familiar or witch) without tributes; the opponent cannot chain for the rest of that turn.
- The extra summon is optional and limited to one monster.
- Shield: if a shield resolves, neither participating monster is destroyed by that battle; damage to the shield user is zero and the battle phase ends after resolution.

All six evaluation/tactical policies were retrained under the current rules, then published to `feature/nagisa` before this tournament. The training workflow run was `34883547451`.

The final round robin used 100 games per unique matchup with a 50/50 seat split. There are 15 unique matchups, so 1,500 games total. There were zero draws and zero truncated games. Round-robin workflow run: `34883955369`.

## Overall standings

| Rank | Character | Wins | Losses | Win rate |
|---:|---|---:|---:|---:|
| 1 | Kyoko | 291 | 209 | 58.2% |
| 2 | Nagisa | 286 | 214 | 57.2% |
| 3 | Madoka | 271 | 229 | 54.2% |
| 4 | Mami | 249 | 251 | 49.8% |
| 5 | Sayaka | 243 | 257 | 48.6% |
| 6 | Homura | 160 | 340 | 32.0% |

## Pairwise results

Each value is the row character's win rate against the column character.

| Character | Madoka | Mami | Sayaka | Kyoko | Homura | Nagisa |
|---|---:|---:|---:|---:|---:|---:|
| Madoka | — | 57% | 53% | 52% | 76% | 33% |
| Mami | 43% | — | 57% | 42% | 68% | 39% |
| Sayaka | 47% | 43% | — | 38% | 70% | 45% |
| Kyoko | 48% | 58% | 62% | — | 75% | 48% |
| Homura | 24% | 32% | 30% | 25% | — | 49% |
| Nagisa | 67% | 61% | 55% | 52% | 51% | — |

## Homura comparison

The preceding 100-game-per-pair tournament had Homura at 33.4%. Under this ruleset and the newly retrained policies, Homura is 32.0%. The exact percentage is noisy at 100 games per matchup, but Homura loses heavily to Madoka, Mami, Sayaka, and Kyoko; only the Nagisa matchup is close at 49/51.

## AI method

These policies are approximate decision optimizers, not exact game-theoretic solvers. Legal actions are scored using a numerical evaluation function; character-specific tactics handle special-move decisions; policy weights and special-use thresholds are tuned by evolutionary search across repeated games. The final tournament therefore measures the strength of the resulting policies under the current rules, but it does not prove a mathematically optimal strategy or Nash equilibrium.
