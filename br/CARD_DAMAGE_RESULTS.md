# Card damage attribution in the 100-game mutual-rollout probe

This report uses the same current-meta mutual hidden-information rollout configuration that produced the previously validated 49% Madoka / 51% Mami result:

- 100 games
- seed `2026091601`
- 16 hidden-world samples per non-forced decision
- maximum 300 actions
- minimum accepted rollout gain `0.05`
- all 100 games terminated normally
- rollout cutoffs: 0
- reproduced result: Madoka 49 wins / Mami 51 wins

## Metric

The primary metric is **effective deck damage**: the number of cards actually removed from the opponent's remaining deck by combat damage. This differs from nominal damage when an attack overkills a nearly empty deck. For example, nominal 13 damage against a 3-card deck counts as 3 effective deck damage.

Damage is attributed to the participating monster that caused the damage. For a direct attack or an attacking monster that wins combat, damage belongs to the attacker. If the defender wins combat and deals damage back, damage belongs to the defender. Equal-power battles deal no damage. Boost contribution is included in the participating monster's result; it is not split out as a separate magic-card damage source.

## Overall ranking by effective deck damage

| Rank | Character | Card | Base ATK | Appearances | Damaging hits | Effective deck damage | Direct | Battle | Damage / appearance |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | Mami | ワルプルギスの夜 | 13 | 48 | 53 | **352** | 155 | 197 | 7.33 |
| 2 | Madoka | 救済の魔女 | 13 | 65 | 50 | **291** | 37 | 254 | 4.48 |
| 3 | Madoka | 人魚の魔女 B | 10 | 45 | 30 | **158** | 23 | 135 | 3.51 |
| 4 | Mami | お菓子の魔女 A | 10 | 36 | 30 | **156** | 65 | 91 | 4.33 |
| 5 | Madoka | 人魚の魔女 A | 10 | 37 | 29 | **138** | 24 | 114 | 3.73 |
| 6 | Madoka | 委員長の魔女 | 8 | 70 | 28 | **137** | 27 | 110 | 1.96 |
| 7 | Mami | お菓子の魔女 B | 10 | 35 | 27 | **134** | 68 | 66 | 3.83 |
| 8 | Mami | お菓子の魔女の使い魔 | mixed 3/4/5 | 115 | 31 | **115** | 104 | 11 | 1.00 |
| 9 | Mami | 影の魔女 | 8 | 38 | 18 | **100** | 47 | 53 | 2.63 |
| 10 | Mami | 影の魔女の使い魔 | mixed 3/4/5 | 112 | 22 | **75** | 62 | 13 | 0.67 |
| 11 | Madoka | 薔薇園の魔女 | 8 | 48 | 15 | **74** | 13 | 61 | 1.54 |
| 12 | Mami | 芸術家の魔女 | 8 | 41 | 10 | **53** | 35 | 18 | 1.29 |
| 13 | Madoka | 委員長の魔女の使い魔 | mixed 3/4/5 | 76 | 16 | **42** | 10 | 32 | 0.55 |
| 14 | Madoka | 薔薇園の魔女の使い魔 | mixed 3/4/5 | 94 | 16 | **35** | 11 | 24 | 0.37 |

## Tier totals

### Madoka

| Tier | Effective deck damage | Share of Madoka combat damage | Appearances | Damage / appearance |
|---|---:|---:|---:|---:|
| ATK 10: 人魚 A+B | **296** | **33.83%** | 82 | 3.61 |
| ATK 13: 救済 | **291** | **33.26%** | 65 | 4.48 |
| ATK 8 witches | **211** | **24.11%** | 118 | 1.79 |
| Familiars | **77** | **8.80%** | 170 | 0.45 |
| Total | **875** | 100% | 435 | — |

The two Mermaid Witch cards combined dealt five more effective deck damage than Salvation Witch (296 vs 291). Salvation Witch remains the strongest single Madoka card, but the ATK-10 tier is marginally the largest damage source as a two-card package.

### Mami

| Tier | Effective deck damage | Share of Mami combat damage | Appearances | Damage / appearance |
|---|---:|---:|---:|---:|
| ATK 13: ワルプルギス | **352** | **35.74%** | 48 | 7.33 |
| ATK 10: お菓子 A+B | **290** | **29.44%** | 71 | 4.08 |
| Familiars | **190** | **19.29%** | 227 | 0.84 |
| ATK 8 witches | **153** | **15.53%** | 79 | 1.94 |
| Total | **985** | 100% | 425 | — |

Walpurgisnacht is clearly Mami's largest single and tier-level damage source. The two Candy Witch cards form the second-largest source, while Mami's familiars contribute substantial direct damage because they appear frequently.

## Interpretation

Damage output confirms that the game is not skipping the middle tier. Madoka's ATK-10 Mermaid package and ATK-13 Salvation Witch each account for roughly one third of her combat damage, with the Mermaid package slightly ahead in total effective damage. Mami is more top-heavy: Walpurgisnacht alone accounts for about 35.7% of her combat damage, but Candy Witch A+B still contribute another 29.4%.

Thus, by actual effective damage, Madoka has a **two-pillar offense (Mermaid 10 + Salvation 13)**, while Mami has a **Walpurgis-led offense with Candy 10 as the secondary core**. The ATK-8 tier and familiars remain strategically important for board control, tribute economy, and direct chip damage even when they are not the top damage dealers.
