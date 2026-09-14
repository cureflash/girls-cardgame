# Nagisa passive AI retrain and round robin

Product AI base: `d95197a68702cc351a7e7d1a658610861866b2be` on `feature/nagisa`.

Rules added before retraining:

- Nagisa passive: when Nagisa's familiar would be destroyed by battle, once per turn it returns to Nagisa's hand instead of going to the graveyard.
- Nagisa special: when the opponent controls exactly one monster, Nagisa can control that monster and make it directly attack its own controller. When the opponent controls more than one monster this direct-attack route is unavailable. The existing direct attack with Nagisa's own monster remains available when the opponent controls no monsters.

All six character AIs were retrained after those rule changes. Character card values and deck contents were not changed.

Evaluation used all 15 unique pairings among Madoka, Mami, Sayaka, Kyoko, Homura, and Nagisa. Each pairing played 100 games, split evenly between seats (50/50), for 1,500 games total. There were 0 draws and 0 truncated games.

## Overall standings

| Rank | Character | Wins | Losses | Win rate |
|---:|---|---:|---:|---:|
| 1 | Mami | 338 | 162 | 67.6% |
| 2 | Madoka | 281 | 219 | 56.2% |
| 3 | Sayaka | 267 | 233 | 53.4% |
| 4 | Kyoko | 222 | 278 | 44.4% |
| 5 | Nagisa | 201 | 299 | 40.2% |
| 6 | Homura | 191 | 309 | 38.2% |

## Pairwise results

Each value is the row character's win rate against the column character.

| Character | Madoka | Mami | Sayaka | Kyoko | Homura | Nagisa |
|---|---:|---:|---:|---:|---:|---:|
| Madoka | — | 39% | 58% | 59% | 64% | 61% |
| Mami | 61% | — | 58% | 69% | 73% | 77% |
| Sayaka | 42% | 42% | — | 64% | 63% | 56% |
| Kyoko | 41% | 31% | 36% | — | 56% | 58% |
| Homura | 36% | 27% | 37% | 44% | — | 47% |
| Nagisa | 39% | 23% | 44% | 42% | 53% | — |

Nagisa improved from 31.8% in the preceding shield-rule 100-game-per-pair round robin to 40.2%, a gain of 8.4 percentage points. Its matchup win rates changed from 36% to 39% vs Madoka, 16% to 23% vs Mami, 40% to 44% vs Sayaka, 29% to 42% vs Kyoko, and 38% to 53% vs Homura.

AI retraining workflow run: `34873511736`.
Round-robin workflow run: `34874425194`.
