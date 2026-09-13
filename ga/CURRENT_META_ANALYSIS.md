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

The next validation applies the hidden-information conservative rollout planner to Madoka against this retrained Mami champion on paired seeds.
