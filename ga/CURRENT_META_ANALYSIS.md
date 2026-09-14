# Current-meta GA analysis

This analysis retrains Madoka and Mami evaluation policies on the current 30-card deck and current shield semantics without publishing them to the browser opponent.

The run bootstraps from the published generation-999 character genomes, then evolves both populations together under the current engine.

## 100-generation result

A 400-game seat-balanced evaluation of generation 99 produced:

- Madoka: 167 wins / 233 losses = 41.75%
- Mami: 233 wins / 167 losses = 58.25%
- Madoka first: 69 / 200 = 34.5%
- Madoka second: 98 / 200 = 49.0%
- truncated games: 0

The analysis champions are stored in `ga/current-meta-analysis-pair.json` and are not published to the browser opponent.

## Hidden-information rollout best response

The current-meta Madoka champion was then compared with a conservative hidden-information rollout planner while keeping the current-meta Mami champion fixed. The planner never reads the opponent's actual hidden hand or future deck order; it resamples hidden worlds consistent with the public state and only deviates from the current-meta Madoka policy when the estimated gain is at least 0.05.

Configuration:

- games: 100 paired seeds
- hidden-world samples per decision: 16
- max actions: 300
- minimum accepted gain: 0.05
- all games terminated normally
- rollout cutoffs: 0

Results:

| Madoka policy vs current-meta Mami | Wins | Losses | Win rate |
|---|---:|---:|---:|
| Current-meta Madoka champion | 42 | 58 | 42% |
| Conservative rollout planner | 84 | 16 | 84% |

Observed lift: **+42 percentage points**.

Paired outcomes on the same 100 seeds:

- both win: 40
- both lose: 14
- planner-only win: 44
- current-meta Madoka-only win: 2
- two-sided paired sign-test p-value: **3.0752289603697136e-11**

The planner made 2,680 non-forced decisions and deviated from the current-meta Madoka champion on 597 of them (22.28%). The most common deviations were:

1. end turn: 155
2. summon ATK 5 familiar: 48
3. summon ATK 4 familiar: 48
4. use +2 boost: 48
5. use +3 boost: 46
6. enter battle: 41
7. summon ATK 3 familiar: 31
8. summon ATK 10 witch: 30
9. pass: 28
10. use shield: 22
11. continue battle: 12
12. use Pluvia Magica: 11
13. summon ATK 8 witch: 8
14. use +5 boost: 7
15. summon ATK 13 witch: 1

## Current interpretation

The current-meta GA still favors Mami when both sides use their evolved one-step evaluation policies, but Madoka has a large exploitable strategy gap against that fixed Mami policy. The rollout planner's gains do **not** primarily come from rushing Salvation Witch or from always firing shields. The dominant pattern is selective tempo/resource management: ending low-value turns, keeping ordinary familiars available, using small boosts precisely, and choosing when to enter or continue battle.

This is a practical best response to the current-meta Mami champion, not an exact Nash equilibrium. It does not yet prove that Madoka has an 84% intrinsic matchup against a mathematically optimal Mami player.
