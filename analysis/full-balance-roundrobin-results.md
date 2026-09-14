# Full balance AI retrain and round robin

Product rule/policy branch: `feature/nagisa`, product HEAD used for the tournament: `d4a34631dfb7230d2db6ecf74119112f1982132e`.

Latest balance changes in this run:

- Mami starts with one fewer card: opening hand 4.
- Kyoko has no passive: opening hand returns to the normal 5; her special is unchanged.
- Homura starts with the normal 5 cards. On her own turn, the first attack-up card she uses gains an additional +2 boost. Her chain-lock special is unchanged.
- Nagisa keeps the lone-opponent direct-attack route and once-per-turn familiar return passive from the preceding ruleset.
- The ordinary attacking-side opening-shield restriction remains active.

All six character AIs were retrained under these rules. Retraining workflow run: `34878576926`.

The final round robin used the published retrained policies from `feature/nagisa`. All 15 unique pairings played 100 games each, split evenly between seats (50/50), for 1,500 games total. There were 0 draws and 0 truncated games. Round-robin workflow run: `34879251277`.

## Overall standings

| Rank | Character | Wins | Losses | Win rate |
|---:|---|---:|---:|---:|
| 1 | Nagisa | 300 | 200 | 60.0% |
| 2 | Kyoko | 293 | 207 | 58.6% |
| 3 | Mami | 257 | 243 | 51.4% |
| 4 | Madoka | 245 | 255 | 49.0% |
| 5 | Sayaka | 238 | 262 | 47.6% |
| 6 | Homura | 167 | 333 | 33.4% |

## Pairwise results

Each value is the row character's win rate against the column character.

| Character | Madoka | Mami | Sayaka | Kyoko | Homura | Nagisa |
|---|---:|---:|---:|---:|---:|---:|
| Madoka | — | 39% | 54% | 54% | 65% | 33% |
| Mami | 61% | — | 55% | 45% | 66% | 30% |
| Sayaka | 46% | 45% | — | 44% | 63% | 40% |
| Kyoko | 46% | 55% | 56% | — | 72% | 64% |
| Homura | 35% | 34% | 37% | 28% | — | 33% |
| Nagisa | 67% | 70% | 60% | 36% | 67% | — |

## Change from the preceding 100-game-per-pair round robin

| Character | Previous | Current | Change |
|---|---:|---:|---:|
| Mami | 67.6% | 51.4% | -16.2 pp |
| Madoka | 56.2% | 49.0% | -7.2 pp |
| Sayaka | 53.4% | 47.6% | -5.8 pp |
| Kyoko | 44.4% | 58.6% | +14.2 pp |
| Nagisa | 40.2% | 60.0% | +19.8 pp |
| Homura | 38.2% | 33.4% | -4.8 pp |
