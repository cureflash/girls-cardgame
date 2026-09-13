# Strategy solver

`npm run cfr:solve` runs the current bucketed imperfect-information regret solver.

It is an approximation, not an exact full-game Nash solver. The information state excludes opponent hand identities and both deck orders, and buckets exact turn/deck counts plus mechanically equivalent cards to improve state reuse. Reports include evaluation coverage (`1 - fallbackRate`); low coverage must not be interpreted as an optimal-strategy result.

The GitHub Actions strategy run uses a 50% minimum coverage gate for preliminary interpretation.
