# Current-meta GA analysis

This analysis retrains Madoka and Mami evaluation policies on the current 30-card deck and current shield semantics without publishing them to the browser opponent.

The run bootstraps from the published generation-999 character genomes, then evolves both populations together under the current engine. The resulting `latest.json` pair and a 400-game seat-balanced evaluation are uploaded as a workflow artifact for strategy analysis.
