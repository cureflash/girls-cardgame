# Dual rollout probe

Both Madoka and Mami use the same conservative hidden-information Monte Carlo rollout rule on top of the current-meta generation-99 evaluation pair.

Each side keeps its own visible/private information fixed, resamples only hidden information, retains its current-meta concrete action as a candidate, and deviates only when the estimated gain is at least 0.05.

This is a mutual online policy-improvement probe. It is not claimed to be an exact Nash-equilibrium solver.
