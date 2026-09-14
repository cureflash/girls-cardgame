# Witch usage in the 100-game mutual-rollout probe

This report uses the same current-meta mutual hidden-information rollout configuration as the 49% Madoka / 51% Mami probe:

- 100 games
- seed `2026091601`
- 16 hidden-world samples per non-forced decision
- maximum 300 actions
- minimum accepted rollout gain `0.05`
- all 100 games terminated normally

`Appearances` means actual entries to the field: normal summons plus revivals. `Games seen` is counted separately for each named card, so A/B game counts must not be added to estimate the number of games in which at least one member of the pair appeared.

## Madoka witches

| Card | ATK | Normal summons | Revivals | Field appearances | Games seen |
|---|---:|---:|---:|---:|---:|
| 薔薇園の魔女 | 8 | 45 | 3 | 48 | 40 |
| 委員長の魔女 | 8 | 63 | 7 | 70 | 55 |
| 人魚の魔女 A | 10 | 24 | 13 | 37 | 33 |
| 人魚の魔女 B | 10 | 28 | 17 | 45 | 37 |
| 救済の魔女 | 13 | 40 | 25 | 65 | 51 |

Combined 人魚の魔女 A+B:

- normal summons: **52**
- revivals: **30**
- field appearances: **82**

Thus the two ATK-10 Mermaid Witch cards produced more total field appearances than Salvation Witch (82 vs 65), although Salvation Witch is a single card and each Mermaid variant is counted separately.

## Mami witches

| Card | ATK | Normal summons | Revivals | Field appearances | Games seen |
|---|---:|---:|---:|---:|---:|
| 影の魔女 | 8 | 38 | 0 | 38 | 32 |
| 芸術家の魔女 | 8 | 41 | 0 | 41 | 38 |
| お菓子の魔女 A | 10 | 36 | 0 | 36 | 36 |
| お菓子の魔女 B | 10 | 35 | 0 | 35 | 35 |
| ワルプルギスの夜 | 13 | 48 | 0 | 48 | 48 |

Combined お菓子の魔女 A+B:

- normal summons: **71**
- revivals: **0** (Mami has no revival special)
- field appearances: **71**

Thus the two ATK-10 Candy Witch cards also produced more total field appearances than Walpurgisnacht (71 vs 48).

## Interpretation

The optimized mutual-rollout games do not bypass the ATK-10 tier. ATK-10 witches are a regular part of the game plan on both sides. The results support a midrange/tempo interpretation: ATK-8 and ATK-10 witches are used substantially, while the ATK-13 finisher remains important without being the sole route to a competitive position.
