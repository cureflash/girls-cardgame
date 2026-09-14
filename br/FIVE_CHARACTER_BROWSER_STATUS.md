# Five-character browser integration status

## Browser rules

The browser now uses the canonical five-character engine/adapter entry points and exposes all five character choices.

- Madoka: opening 5, battle damage -1, Pluvia Magica.
- Mami: opening 5, no passive, Tiro Finale.
- Sayaka: opening 5, witch tribute requirement -3, recycle any 3 graveyard cards and shuffle.
- Kyoko: opening 4, use exactly one opposing familiar/witch as tribute toward a witch special summon.
- Homura: opening 8, no attack bonus, once-per-duel opponent chain lock while Homura continues battle and may boost.

## Browser deck visuals

Character ability and deck artwork are independent.

- Human/player side always uses the Madoka visual deck, including Salvation Witch.
- CPU/NPC side always uses the Mami visual deck, including Walpurgis Night.
- The two visual decks remain mechanically identical.
- Player/NPC browser deck card ids use distinct prefixes so mirror character matches do not collide.

## UI

- All five characters can be selected for the player and opponent.
- All five character portraits render beside the field.
- Sayaka recycle selection and Kyoko opponent-tribute / witch-summon selections have browser dialogs.
- Homura can continue to battle after using her special; the opponent is chain-locked while Homura can still use boosts.
- Current character rules are shown in the in-page rules section.

## Regression gates

- Standard repository regression workflow: PASS after compatibility fixes.
- Dedicated five-character browser workflow: PASS.
- Dedicated tests cover exact opening-hand modifiers, player Salvation visual deck, NPC Walpurgis visual deck, mirror-match id uniqueness, five portraits, and the canonical five-character engine/adapter.

This commit triggers the existing current-meta opening-hand rollout so the 1,000-game balance result can be rechecked after browser integration.
