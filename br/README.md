# Rollout best response

`npm run br:solve` estimates a practical best response against the current browser baseline AI.

For every non-forced decision it keeps the acting player's visible/private information fixed, resamples the acting player's unknown future deck plus the opponent's hidden hand/deck from the known deck lists, and evaluates each strategically distinct legal action by rolling the rest of the sampled game with the published baseline policy.

This does not claim an exact Nash equilibrium. It is an online hidden-information Monte Carlo rollout policy against a fixed opponent, intended to answer the practical question: **what should this player do to maximize win probability against the current baseline AI?**

The report always includes a baseline-vs-baseline control using the same game seeds so the observed win-rate lift can be compared directly.
