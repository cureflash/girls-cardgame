# Best-response strategy results

## Scope

This result is a **practical best response to the current published baseline AI**, not an exact Nash equilibrium of the full imperfect-information game.

The planner never reads the opponent's actual hidden hand or deck order. At each decision it samples hidden worlds consistent with the known deck lists and public state, evaluates strategically distinct legal actions on paired samples, and keeps the baseline action unless the estimated gain is at least 0.05.

## Current validated run

Configuration:

- character: Madoka
- opponent: current published Mami baseline AI
- games: 100 paired seeds
- hidden-world samples per decision: 16
- max actions per rollout: 220
- minimum accepted gain over baseline: 0.05
- all 100 baseline and planner games terminated normally
- rollout cutoffs: 0

Before this validation, the evaluation AI was fixed to match the engine rule that a shield protects a participating **familiar or witch** from destruction. A regression test now covers shield protection of witches.

Results after that fix:

| Policy | Wins | Losses | Win rate |
|---|---:|---:|---:|
| Published Madoka baseline | 41 | 59 | 41% |
| Conservative rollout planner | 61 | 39 | 61% |

Observed lift: **+20 percentage points**.

Paired outcomes on the same 100 seeds:

- both win: 30
- both lose: 28
- planner-only win: 31
- baseline-only win: 11
- two-sided paired sign-test p-value: **0.002887247974285856**

The planner made 2,492 non-forced decisions and deviated from the baseline on 644 of them (**25.84%**).

## What the planner changes most often

Top accepted deviations from the baseline policy:

1. end turn: 195
2. pass: 55
3. summon ATK 3 familiar: 50
4. use +2 boost: 49
5. summon ATK 5 familiar: 46
6. summon ATK 4 familiar: 38
7. use +3 boost: 38
8. enter battle: 32
9. use Pluvia Magica: 19
10. summon ATK 8 witch: 14
11. use +5 boost: 12
12. summon ATK 10 witch: 11
13. summon ATK 13 witch: 2
14. use shield instead of baseline: 1

Interpretation: the largest improvement is **not** simply “summon Salvation Witch as fast as possible” or “use shield more often.” After fixing shield evaluation, the baseline already handles shield reasonably well. The rollout planner gains mainly by being more selective: it frequently declines low-value continuations, preserves resources, and uses ordinary familiars and small boosts more deliberately. High-cost boss summons are comparatively rare deviations.

## Important limitation

This validates a strong policy **against the current baseline Mami AI**. It does not prove that the same policy is a Nash equilibrium or that Madoka has a 61% intrinsic matchup against a mathematically optimal Mami player. Hidden-state sampling is also not yet conditioned on all information implied by the opponent's previous choices.
