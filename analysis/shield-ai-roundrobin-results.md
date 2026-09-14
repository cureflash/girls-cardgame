# Shield-rule AI retrain and round robin

Product AI commit: `70f42d7c3bf3ab54bc8add9a1c043d5aea792936` on `feature/nagisa`.

All six character AIs were retrained after the normal-battle shield rule was changed so that the attacking side cannot use shield as the first chain action. Character abilities, card values, and decks were not changed for this retrain.

Evaluation used all 15 unique pairings among Madoka, Mami, Sayaka, Kyoko, Homura, and Nagisa. Each pairing played 100 games, split evenly between seats (50/50), for 1,500 games total. There were 0 draws and 0 truncated games.

## Overall standings

| Character | Wins | Losses | Win rate |
|---|---:|---:|---:|
| Mami | 334 | 166 | 66.8% |
| Madoka | 279 | 221 | 55.8% |
| Kyoko | 263 | 237 | 52.6% |
| Sayaka | 255 | 245 | 51.0% |
| Homura | 210 | 290 | 42.0% |
| Nagisa | 159 | 341 | 31.8% |

## Pairwise results

Each value is the row character's win rate against the column character.

| Character | Madoka | Mami | Sayaka | Kyoko | Homura | Nagisa |
|---|---:|---:|---:|---:|---:|---:|
| Madoka | — | 41% | 57% | 53% | 64% | 64% |
| Mami | 59% | — | 59% | 66% | 66% | 84% |
| Sayaka | 43% | 41% | — | 55% | 56% | 60% |
| Kyoko | 47% | 34% | 45% | — | 66% | 71% |
| Homura | 36% | 34% | 44% | 34% | — | 62% |
| Nagisa | 36% | 16% | 40% | 29% | 38% | — |

Round-robin workflow: `34870746162`; result step completed successfully.
