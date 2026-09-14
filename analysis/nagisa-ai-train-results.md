# Nagisa dedicated AI training result

Training branch: `analysis/nagisa-ai-train`, based on `feature/nagisa` before product integration.

GitHub Actions run `34862262448` completed successfully. The dedicated policy search used 18 candidates for 8 generations against Madoka, Mami, Sayaka, Kyoko, and Homura. The selected candidate was `nagisa-g4-child-6-hall-g4` with forced-battle special threshold `140`.

Final validation used 5,000 games total, 1,000 against each opponent with balanced seats. Result: 3,159 wins, 1,841 losses, 0 draws, 0 truncations, for a 63.18% overall win rate. The special was used 2,353 / 5,000 games (47.06%).

| Opponent | Wins | Losses | Win rate |
|---|---:|---:|---:|
| Madoka | 487 | 513 | 48.7% |
| Mami | 378 | 622 | 37.8% |
| Sayaka | 682 | 318 | 68.2% |
| Kyoko | 912 | 88 | 91.2% |
| Homura | 700 | 300 | 70.0% |

The resulting policy is published on `feature/nagisa` as `nagisa-dedicated-v1` in `src/nagisa-policy.js`. The implementation keeps Nagisa's existing forced-battle tactical selector, uses the trained evaluation genome for normal turns, and suppresses SPECIAL below the trained threshold so the generic fallback cannot bypass that gate.
