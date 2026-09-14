# Kyoko no-passive balance pilot

This pilot evaluates Kyoko after adding her with no passive skill.

## Implemented Kyoko rules

- Passive: none.
- Special: once per duel at battle-phase start, choose exactly one opposing familiar or witch and count that card as tribute toward summoning one witch from Kyoko's hand.
- If the opposing card does not fully satisfy the witch's printed tribute threshold, Kyoko pays the remainder using the normal own tribute rules: own field familiar/witch and own hand familiars.
- Only one opposing monster can be used.
- The opposing tribute goes to its owner's graveyard.
- The special is available only if the selected opposing monster can actually participate in a legal witch summon.
- The special summon is additional to the normal once-per-turn summon and ends the turn when resolved.
- Kyoko's deck is mechanically identical to Madoka, Mami, and Sayaka: 30 cards with the same counts, ATK distribution, printed tribute costs, and magic effects. Only character ability and eventual names/art differ.

## Regression validation

- Kyoko mechanical deck equality: PASS.
- Opposing ATK 10 + own ATK 3 can summon an ATK 13 witch: PASS.
- Opposing ATK 13 can alone satisfy an ATK 13 witch tribute requirement: PASS.
- Only the selected one opposing monster is tributed: PASS.
- Special is unavailable when no legal resulting witch summon exists: PASS.
- Existing core regressions: PASS.
- 300-duel regression: PASS.

## Pilot conditions

- 40 games per matchup.
- 20 games in each seat arrangement.
- 4 hidden-world rollout samples per non-forced decision.
- Conservative rollout improvement threshold: 0.05.
- Max 300 actions.
- Same shared evaluation baseline and rollout method for all characters.
- 0 truncated games and 0 rollout cutoffs.

## Pairwise results

| Matchup | Wins | Kyoko win rate |
|---|---:|---:|
| Madoka vs Kyoko | 20 - 20 | 50.0% |
| Mami vs Kyoko | 20 - 20 | 50.0% |
| Sayaka vs Kyoko | 11 - 29 | 72.5% |

Across the three pilot matchups, Kyoko finished 69-51, or 57.5%.

## Special usage and tribute value

| Opponent | Kyoko special uses | Opposing tribute ATK total | Witch ATK summoned by special |
|---|---:|---:|---:|
| Madoka | 31 | 247 | 297 |
| Mami | 34 | 294 | 323 |
| Sayaka | 31 | 258 | 289 |

The special was used in 96 of 120 Kyoko games in this pilot. The average opposing tribute value when used was approximately 8.32 ATK (799 / 96), and the average witch summoned by the special was approximately 9.47 ATK (909 / 96).

## Interpretation

The no-passive Kyoko design is already competitively strong in this pilot. It does not show an obvious advantage against Madoka or Mami, where both matchups were exactly 20-20, but it shows a very large favorable matchup against Sayaka at 29-11.

This interaction is structurally plausible: Sayaka's passive encourages efficient investment into witches, while Kyoko can convert one opposing monster into both removal and tribute value for her own witch. Against Madoka and Mami, the pilot did not show the same advantage.

Because this is a 40-game-per-matchup pilot with 4 rollout samples, it should be treated as an early balance signal rather than a final equilibrium estimate. The strongest current signal is matchup skew: Kyoko appears roughly even with Madoka/Mami but strongly favored into Sayaka.
