# Strategy solver

`npm run cfr:solve` runs the current imperfect-information strategic regret solver.

It is an approximation, not an exact full-game Nash solver. Opponent hand identities and both deck orders are excluded. Concrete actions are compressed into strategic choices such as low/high summon, pressure/remove attack, shield, small/large boost, special, and high/low revive. A fine information set is backed off to a coarser policy when an exact strategic state has not been trained.

Reports distinguish fine-policy hits, learned backoff hits, and baseline fallback. Preliminary interpretation requires at least 80% learned coverage for both characters; lower coverage must not be presented as an optimal-strategy result.
