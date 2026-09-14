# Homura chain-lock + boost+2 OTK benchmark

Current product rules under test:
- Homura opening hand: +1 (6 cards)
- Passive: every attack-up magic gets +2 on top of its printed value
- Special: opponent cannot chain for the activation turn
- No free monster or witch summon from the special
- Dedicated AI: do not activate special unless a deterministic same-turn OTK line exists; avoid non-special lethal and build toward the OTK state

Benchmark protocol:
- Opponents: Madoka, Mami, Sayaka, Kyoko, Nagisa
- 10 games per opponent
- 5 games Homura first / 5 games Homura second
- 50 games total
- Max 1200 actions/game
- Deterministic seeds: `2026091556 + opponentIndex * 10000 + gameIndex`

| Opponent | Wins | Losses | Win rate | OTK wins | Non-OTK wins | Special games |
|---|---:|---:|---:|---:|---:|---:|
| Madoka | 7 | 3 | 70% | 7 | 0 | 7 |
| Mami | 6 | 4 | 60% | 6 | 0 | 6 |
| Sayaka | 3 | 7 | 30% | 3 | 0 | 3 |
| Kyoko | 5 | 5 | 50% | 5 | 0 | 5 |
| Nagisa | 6 | 4 | 60% | 6 | 0 | 6 |
| **Total** | **27** | **23** | **54%** | **27** | **0** | **27** |

Draws: 0. Truncated games: 0.

All 27 Homura wins were same-turn wins after activating the special. There were 0 non-OTK Homura wins. The special was activated in exactly 27/50 games, and every activation converted into an OTK win in this benchmark.

The previous free-extra-monster/witch-summon OTK benchmark used the same 10-games-per-opponent, 5/5 seat split and deterministic seed formula, and produced 42/50 = 84%. Under the new chain-lock-only special with the boost+2 passive, this benchmark is 27/50 = 54%, a decrease of 30 percentage points.