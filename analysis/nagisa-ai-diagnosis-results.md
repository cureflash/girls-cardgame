# Nagisa AI diagnosis results

Source branch: `feature/nagisa` (product code unchanged). Diagnosis ran only on `analysis/nagisa-ai-diagnosis-run`.

The diagnosis workflow completed successfully. Final comparisons use 5,000 games per variant: 1,000 games against each of Madoka, Mami, Sayaka, Kyoko, and Homura, with seats balanced 500/500 per matchup. No draws or truncations occurred.

## Final results

| Variant | Overall win rate | Madoka | Mami | Sayaka | Kyoko | Homura | Special uses / 5000 |
|---|---:|---:|---:|---:|---:|---:|---:|
| current | 35.14% | 24.3% | 10.6% | 34.6% | 60.1% | 46.1% | 4,997 |
| no-special | 25.48% | 9.4% | 7.3% | 25.3% | 58.0% | 27.4% | 0 |
| threshold-tuned | 41.20% | 33.1% | 23.1% | 36.0% | 70.4% | 43.4% | 2,358 |
| genome-and-threshold-tuned | 60.68% | 47.2% | 35.3% | 65.3% | 89.4% | 66.2% | 2,637 |

The preliminary threshold sweep selected a target-score threshold of 120. In that sweep, disabling special entirely produced 28.8%, while threshold 120 produced 46.4% (500 games each). The final 5,000-game comparison produced 25.48% and 41.20%, respectively.

The genome search selected the currently published Mami evaluation genome as the strongest tested generic evaluation genome. This is a diagnostic control demonstrating that Nagisa's current `DEFAULT_GENOME` normal-turn policy is a major bottleneck; it is not a claim that Mami's genome should be shipped for Nagisa or that 60.68% is Nagisa's final balanced target.

## Interpretation

1. Nagisa's special ability is beneficial: disabling it drops overall win rate from 35.14% to 25.48%.
2. The current special-use policy is too eager: it uses special in 4,997 / 5,000 games. Requiring a stronger immediate target score cuts use to 2,358 / 5,000 and raises win rate to 41.20%.
3. The normal-turn AI is the larger remaining bottleneck. Replacing the untuned default evaluation genome with the strongest tested existing trained genome, while keeping the selective special gate, raises win rate to 60.68%.
4. Therefore the observed ~34-35% current win rate is not explained mainly by Nagisa's character strength. AI policy quality accounts for a large share. Matchup-specific balance may still remain: even the diagnostic stronger policy is below 50% against Mami (35.3%) and slightly below 50% against Madoka (47.2%).
