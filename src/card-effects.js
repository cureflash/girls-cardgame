// Card effects use the existing hand/priority/chain system. No separate set zone.
export const EXTRA_CARDS = Object.freeze({
  evacuation: { name: '強制脱出装置', kind: 'trap', badge: '手札へ戻す', description: 'メインまたは戦闘中に、場の使い魔・魔女1体を持ち主の手札に戻す。戦闘参加中のカードが離れた場合、その戦闘は中止する。' },
  doomed: { name: '死者への手向け', kind: 'spell', badge: '単体破壊', description: 'メインに手札を1枚捨て、場の使い魔・魔女1体を破壊する。無効にされても捨てた手札は戻らない。' },
  doubleSummon: { name: '二重召喚', kind: 'spell', badge: '召喚2回', description: 'このターン、通常召喚を合計2回まで行える。複数枚使っても上限は2回。生贄の条件は変わらない。' },
  jammer: { name: 'マジック・ジャマー', kind: 'trap', badge: '魔法を無効', description: '魔法の発動に応じて手札を1枚捨て、その発動を無効にする。罠・必殺技には使えない。盾は既存ルールどおり即座にチェーンを終了する。' },
  swap: { name: '強制転移', kind: 'spell', badge: '1体ずつ交換', description: '解決時、双方が自分の場の使い魔・魔女を1体ずつ選び、コントロールを交換する。場を離れたカードは元の持ち主の手札・墓地へ送る。' },
  mallet: { name: '打ち出の小槌', kind: 'spell', badge: '手札交換', description: 'メインに自分の手札を任意の枚数選んで山札に戻し、シャッフルして同数引く。発動したこのカードは墓地へ送る。' },
  reincarnate: { name: '死者転生', kind: 'spell', badge: '墓地から回収', description: 'メインに手札を1枚捨て、自分の墓地の使い魔・魔女1体を手札に戻す。コストとして捨てたモンスターも選べる。' },
  reborn: { name: '死者蘇生', kind: 'spell', badge: '1体蘇生', description: 'メインに自分か相手の墓地の使い魔・魔女1体を自分の場に蘇生する。通常召喚の回数は使わない。' },
  avarice: { name: '貪欲な壺', kind: 'spell', badge: '5体戻し2枚引く', description: 'メインに自分の墓地の使い魔・魔女5体を山札へ戻してシャッフルし、2枚引く。' },
});

export const EXTRA_DECKS = Object.freeze({
  mami: [['evacuation', 2], ['jammer', 2]],
  madoka: [['evacuation', 2], ['jammer', 2]],
});

export const isMonster = card => card && ['familiar', 'witch'].includes(card.type);
export const isExtraCard = card => !!EXTRA_CARDS[card?.effect];
const fieldOptions = e => e.state.players.flatMap((p, player) => p.field.flatMap((card, slot) => isMonster(card) ? [{ key: `field:${player}:${card.id}`, player, zone: 'field', slot, card: { ...card } }] : []));
const graveOptions = (e, players) => players.flatMap(player => e.player(player).graveyard.filter(isMonster).map(card => ({ key: `grave:${player}:${card.id}`, player, zone: 'graveyard', card: { ...card } })));
const handOptions = (e, player, excluded) => e.player(player).hand.filter(card => card.id !== excluded).map(card => ({ key: `hand:${player}:${card.id}`, player, zone: 'hand', card: { ...card } }));
const topSpell = e => {
  const item = e.state.chain.at(-1);
  return item && !item.negated && item.card.kind !== 'trap' ? item : null;
};

export function canUseExtraCard(e, player, card, response = false) {
  const p = e.player(player), otherHand = p.hand.filter(c => c.id !== card.id);
  const fields = fieldOptions(e);
  if (response && !['evacuation', 'jammer'].includes(card.effect)) return false;
  switch (card.effect) {
    case 'evacuation': return fields.length > 0;
    case 'doomed': return otherHand.length > 0 && fields.length > 0;
    case 'doubleSummon': return (p.summonLimit ?? 1) < 2;
    case 'jammer': return response && !!topSpell(e) && otherHand.length > 0;
    case 'swap': return e.state.players.every(x => x.field.some(isMonster));
    case 'mallet': return otherHand.length > 0;
    case 'reincarnate': return otherHand.length > 0 && (p.graveyard.some(isMonster) || otherHand.some(isMonster));
    case 'reborn': return p.field.includes(null) && graveOptions(e, [0, 1]).length > 0;
    case 'avarice': return p.graveyard.filter(isMonster).length >= 5;
    default: return false;
  }
}

function ask(e, context, stage, options, { player = context.player, allowDone = false } = {}) {
  e.state.pendingDecision = { type: 'CARD_CHOICE', player, stage, options, allowDone, context };
}

export function beginCardActivation(e, player, cardId, response = false) {
  const card = e.player(player).hand.find(c => c.id === cardId);
  if (!card) throw new Error('発動するカードが手札にありません。');
  const context = { player, cardId, effect: card.effect, response, targets: [], chainTarget: card.effect === 'jammer' ? topSpell(e)?.id : null };
  prepare(e, context);
}

function prepare(e, c) {
  if (['doomed', 'reincarnate', 'jammer'].includes(c.effect) && !c.costPaid) {
    let options = handOptions(e, c.player, c.cardId);
    if (c.effect === 'reincarnate' && !e.player(c.player).graveyard.some(isMonster)) options = options.filter(x => isMonster(x.card));
    return ask(e, c, 'discard', options);
  }
  if (['evacuation', 'doomed'].includes(c.effect) && !c.targets.length) return ask(e, c, 'field', fieldOptions(e));
  if (c.effect === 'reincarnate' && !c.targets.length) return ask(e, c, 'grave', graveOptions(e, [c.player]));
  if (c.effect === 'reborn' && !c.targets.length) return ask(e, c, 'grave', graveOptions(e, [0, 1]));
  if (c.effect === 'avarice' && c.targets.length < 5) {
    return ask(e, c, 'recycle', graveOptions(e, [c.player]).filter(x => !c.targets.some(t => t.key === x.key)));
  }
  if (c.effect === 'mallet' && !c.selectionDone) {
    return ask(e, c, 'hand', handOptions(e, c.player, c.cardId).filter(x => !c.targets.some(t => t.key === x.key)), { allowDone: true });
  }
  commit(e, c);
}

function commit(e, c) {
  const p = e.player(c.player), index = p.hand.findIndex(card => card.id === c.cardId);
  if (index < 0) throw new Error('発動するカードが手札にありません。');
  const [card] = p.hand.splice(index, 1);
  if (e.state.phase !== 'CHAIN') e.state.resumePhase = e.state.phase;
  e.state.pendingDecision = null;
  const item = { id: ++e.state.nextChainId, player: c.player, card, targets: c.targets, chainTarget: c.chainTarget };
  e.state.chain.push(item);
  e.state.chainPassCount = 0;
  e.log(`CHAIN ${e.state.chain.length}: ${p.name}が${card.name}を発動`);
  e.emit('magicActivate', { player: c.player, card: { ...card }, targets: c.targets });
  e.beginChainWindow(e.opponent(c.player));
}

export function selectCardChoice(e, player, key = null) {
  const d = e.state.pendingDecision;
  if (d?.type !== 'CARD_CHOICE' || d.player !== player) throw new Error('カード選択の手番ではありません。');
  if (key === null) {
    if (!d.allowDone) throw new Error('カードの選択が必要です。');
    d.context.selectionDone = true;
    e.state.pendingDecision = null;
    prepare(e, d.context);
    return;
  }
  const choice = d.options.find(x => x.key === key);
  if (!choice) throw new Error('そのカードは選択できません。');
  const c = d.context;
  if (d.stage === 'swap-own' || d.stage === 'swap-opponent') {
    const item = e.state.chain.find(x => x.id === c.itemId);
    const card = e.player(choice.player).field[choice.slot];
    if (!item || card?.id !== choice.card.id) throw new Error('交換するカードが場にありません。');
    if (d.stage === 'swap-own') {
      c.own = choice;
      ask(e, c, 'swap-opponent', fieldOptions(e).filter(x => x.player === e.opponent(c.player)), { player: e.opponent(c.player) });
    } else {
      const own = e.player(c.player).field[c.own.slot];
      if (own?.id !== c.own.card.id) throw new Error('交換するカードが場にありません。');
      own.ownerPlayer ??= c.player;
      card.ownerPlayer ??= choice.player;
      e.player(c.player).field[c.own.slot] = card;
      e.player(choice.player).field[choice.slot] = own;
      item.resolutionComplete = true;
      e.state.pendingDecision = null;
      e.emit('controlSwap', { player: c.player, own: { ...own }, opponent: { ...card } });
      e.log(`${own.name}と${card.name}のコントロールを交換`);
      e.resolveChainAndBattle();
    }
    return;
  }
  if (d.stage === 'discard') {
    const p = e.player(player), index = p.hand.findIndex(card => card.id === choice.card.id && card.id !== c.cardId);
    if (index < 0) throw new Error('捨てるカードが手札にありません。');
    const [card] = p.hand.splice(index, 1);
    e.sendToGraveyard(card, player);
    e.emit('discard', { player, card: { ...card }, reason: c.effect });
    c.costPaid = true;
  } else {
    c.targets.push(choice);
  }
  e.state.pendingDecision = null;
  prepare(e, c);
}

function findTarget(e, ref) {
  if (!ref) return null;
  const zone = e.player(ref.player)[ref.zone];
  return ref.zone === 'field' ? (zone[ref.slot]?.id === ref.card.id ? zone[ref.slot] : null) : zone.find(card => card.id === ref.card.id);
}

// false pauses resolution for an interactive choice; null delegates legacy effects.
export function resolveExtraCard(e, item) {
  const { card, player, targets = [] } = item, p = e.player(player);
  if (!isExtraCard(card) && card.effect !== 'draw') return null;
  if (item.resolutionComplete) return true;
  const ref = targets[0], target = findTarget(e, ref);
  switch (card.effect) {
    case 'draw': e.draw(player, card.value ?? 0); break;
    case 'evacuation':
      if (target) {
        e.player(ref.player).field[ref.slot] = null;
        e.player(e.cardOwner(target, ref.player)).hand.push(target);
        e.emit('returnToHand', { player: e.cardOwner(target, ref.player), card: { ...target }, reason: 'evacuation' });
      }
      break;
    case 'doomed': if (target) e.destroy(ref.player, ref.slot, 'doomed'); break;
    case 'doubleSummon': p.summonLimit = 2; break;
    case 'jammer': {
      const negated = e.state.chain.find(x => x.id === item.chainTarget);
      if (negated) {
        negated.negated = true;
        e.emit('magicNegated', { player: negated.player, card: { ...negated.card }, by: player });
        e.log(`${card.name}で${negated.card.name}を無効にした`);
      }
      break;
    }
    case 'swap':
      if (e.state.players.every(x => x.field.some(isMonster))) {
        ask(e, { player, itemId: item.id }, 'swap-own', fieldOptions(e).filter(x => x.player === player));
        return false;
      }
      break;
    case 'mallet': {
      const ids = new Set(targets.map(x => x.card.id));
      const returned = p.hand.filter(x => ids.has(x.id));
      p.hand = p.hand.filter(x => !ids.has(x.id));
      p.deck = e.shuffle([...p.deck, ...returned]);
      e.draw(player, returned.length);
      break;
    }
    case 'reincarnate':
      if (target) { p.graveyard.splice(p.graveyard.indexOf(target), 1); p.hand.push(target); }
      break;
    case 'reborn':
      if (target && p.field.includes(null)) {
        const grave = e.player(ref.player).graveyard;
        grave.splice(grave.indexOf(target), 1);
        const slot = p.field.indexOf(null);
        p.field[slot] = target;
        target.attackedTurn = null;
        e.emit('revive', { player, slot, card: { ...target }, reason: 'reborn' });
      }
      break;
    case 'avarice': {
      const returned = targets.map(x => findTarget(e, x));
      if (returned.length === 5 && returned.every(Boolean)) {
        const ids = new Set(returned.map(x => x.id));
        p.graveyard = p.graveyard.filter(x => !ids.has(x.id));
        p.deck = e.shuffle([...p.deck, ...returned]);
        e.draw(player, 2);
      }
      break;
    }
  }
  return true;
}
