# Five-character browser integration status

## Browser rules

The browser uses the canonical five-character engine/adapter entry points and exposes all five character choices.

- Madoka: opening 5, battle damage -1, Pluvia Magica.
- Mami: opening 5, no passive, Tiro Finale.
- Sayaka: opening 5, witch tribute requirement -3, recycle any 3 graveyard cards and shuffle.
- Kyoko: opening 4, use exactly one opposing familiar/witch as tribute toward a witch special summon.
- Homura: opening 8, no attack bonus, once-per-duel opponent chain lock while Homura continues battle and may boost.

The base engine no longer contains the former Mami-specific opening-hand bonus. Opening-hand size is derived from the character's `openingHandModifier`.

## Browser deck visuals

Character ability and deck artwork are independent.

- Human/player side always uses the Madoka visual deck, including Salvation Witch.
- CPU/NPC side always uses the Mami visual deck, including Walpurgis Night.
- This remains true when the human chooses second seat.
- The two visual decks remain mechanically identical.
- Player/NPC browser deck card ids use distinct prefixes so mirror character matches do not collide.

## UI

- All five characters can be selected independently for the player and opponent.
- All five character portraits render beside the field.
- Sayaka recycle selection and Kyoko opponent-tribute / witch-summon selections have browser dialogs.
- Homura can continue to battle after using her special; the opponent is chain-locked while Homura can still use boosts.
- Current character rules are shown in the in-page rules section.

## Regression gates

- Standard repository regression workflow: PASS.
- Dedicated five-character browser workflow: PASS.
- GitHub Pages build/deployment: PASS.
- Dedicated tests cover exact opening-hand modifiers, player Salvation visual deck, NPC Walpurgis visual deck, mirror-match id uniqueness, five portraits, and the canonical five-character engine/adapter.

## Post-integration balance recheck

The current-meta rollout was repeated after the five-character browser integration.

- 100 games per matchup.
- 10 total pairings / 1,000 games.
- 50 games in each seat arrangement per matchup.
- 4 hidden-world rollout samples per non-forced decision.
- Maximum 300 actions.
- 0 draws, 0 truncated games, 0 rollout cutoffs.

Pairwise results:

| Matchup | Result |
|---|---:|
| Madoka vs Mami | 54 - 46 |
| Madoka vs Sayaka | 43 - 57 |
| Mami vs Sayaka | 43 - 57 |
| Madoka vs Kyoko | 52 - 48 |
| Mami vs Kyoko | 63 - 37 |
| Sayaka vs Kyoko | 48 - 52 |
| Madoka vs Homura | 44 - 56 |
| Mami vs Homura | 45 - 55 |
| Sayaka vs Homura | 51 - 49 |
| Kyoko vs Homura | 59 - 41 |

Aggregate over 400 games per character:

| Rank | Character | Wins | Losses | Win rate |
|---:|---|---:|---:|---:|
| 1 | Sayaka | 213 | 187 | 53.25% |
| 2 | Homura | 201 | 199 | 50.25% |
| 3 | Mami | 197 | 203 | 49.25% |
| 4 | Kyoko | 196 | 204 | 49.00% |
| 5 | Madoka | 193 | 207 | 48.25% |

The first-to-fifth spread remains 5.00 percentage points, exactly matching the pre-browser-integration reference result. The browser integration therefore did not change the tested game balance.
