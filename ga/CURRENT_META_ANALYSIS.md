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

## Reverse hidden-information rollout best response

The same procedure was run in the opposite direction: current-meta Madoka remained fixed while Mami received the conservative rollout planner.

Results:

| Mami policy vs current-meta Madoka | Wins | Losses | Win rate |
|---|---:|---:|---:|
| Current-meta Mami champion | 57 | 43 | 57% |
| Conservative rollout planner | 84 | 16 | 84% |

Observed lift: **+27 percentage points**.

Paired outcomes on the same 100 seeds:

- both win: 51
- both lose: 10
- planner-only win: 33
- current-meta Mami-only win: 6
- two-sided paired sign-test p-value: **1.429926123819314e-5**

The Mami planner made 2,379 non-forced decisions and deviated from the current-meta Mami champion on 583 of them (24.51%). Its most common deviations were: end turn (258), +2 boost (53), +3 boost (44), enter battle (43), summon ATK 3 familiar (40), summon ATK 4 familiar (31), continue battle (19), pass (18), shield (18), summon ATK 5 familiar (11), summon ATK 8 witch (7), +5 boost (6), and Tiro Finale (6).

## Mutual rollout probe

Both characters were then given the same conservative hidden-information rollout rule on top of the same current-meta generation-99 pair. Candidate rollouts still use the fixed current-meta policies after the candidate action, so this is a mutual one-step policy-improvement probe rather than a recursive exact equilibrium solver.

Configuration:

- games: 100
- hidden-world samples per non-forced decision: 16
- max actions: 300
- minimum accepted gain over each character's current-meta action: 0.05
- all 100 games terminated normally
- rollout cutoffs: 0 for both characters

Results:

| Mutual rollout | Wins | Losses | Win rate |
|---|---:|---:|---:|
| Madoka | 49 | 51 | 49% |
| Mami | 51 | 49 | 51% |

Madoka by seat:

- first: 23 / 50 = 46%
- second: 26 / 50 = 52%

Search activity:

- Madoka: 2,864 non-forced decisions, 828 deviations = 28.91%
- Mami: 2,827 non-forced decisions, 1,002 deviations = 35.44%

Most common Madoka deviations: end turn (269), enter battle (70), +2 boost (60), summon ATK 4 familiar (56), summon ATK 5 familiar (49), +3 boost (49), summon ATK 3 familiar (46), pass (44), Pluvia Magica (26), shield (26).

Most common Mami deviations: end turn (452), +2 boost (88), enter battle (84), +3 boost (67), summon ATK 3 familiar (45), shield (45), pass (42), summon ATK 4 familiar (36), continue battle (27), summon ATK 8 witch (20).

## Empirical 2x2 strategy matrix

The following summarizes the four measured policy pairings as Madoka win rate. The unilateral probes use independent balanced seed sets, so the baseline cell varies by roughly one percentage point across runs; this table uses the Madoka-side unilateral baseline result for the base/base cell.

| Madoka \ Mami | Current-meta policy | Rollout policy |
|---|---:|---:|
| Current-meta policy | 42% | 16% |
| Rollout policy | 84% | 49% |

Within this restricted two-strategy set, the rollout policy strictly dominates the current-meta one-step policy for **both** characters. Therefore the empirical restricted-game equilibrium is the rollout/rollout cell, observed here at approximately **49% Madoka / 51% Mami**. This statement is exact only for the measured two-policy strategy set; it is not a proof of full-game Nash equilibrium.

## Current interpretation

The 84% unilateral results are largely best-response exploitation of fixed one-step evaluation policies, not evidence that either character is intrinsically an 84% favorite. When both characters receive the same hidden-information search capability, the matchup moves to **49% / 51%**, essentially even in this 100-game probe.

This also changes the strategic interpretation. The strongest pattern found so far is not pure counterplay or boss rushing. Both sides improve mainly by declining low-value continuations, ending turns earlier, preserving ordinary familiars, using small boosts more precisely, and choosing battle timing more selectively. The current-meta GA's 41.75% / 58.25% split therefore contains a substantial policy-quality component in addition to any underlying card/character balance difference.

The next step toward a deeper equilibrium approximation is to search for a best response to the rollout policy itself rather than to the original current-meta one-step policy. If neither side can gain materially against the mutual rollout policy, the 49/51 result becomes much stronger evidence of approximate equilibrium; if a new response gains sharply, it should be added as another policy in an iterative policy-space response-oracle cycle.
