import { GameEngine, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';
import { ACTIONS } from '../src/rl-adapter.js';

const roster = ['madoka', 'mami', 'sayaka', 'kyoko', 'homura', 'nagisa'];
const gamesPerPair = Number(process.env.GAMES ?? process.argv[2] ?? 100);
const maxActions = 1200;

function rngFor(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function play(ids, seed) {
  const engine = new GameEngine({
    players: ids.map((id, i) => ({ id: `p${i}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })),
    decks: ids.map(createDeck),
    rng: rngFor(seed),
  });
  const adapter = new CharacterAdapter(engine);
  const policyRng = [rngFor(seed ^ 0x9e3779b9), rngFor(seed ^ 0x85ebca6b)];
  let actions = 0;
  let homuraSpecialSeat = null;
  let homuraSpecialTurn = null;

  while (engine.state.phase !== PHASES.GAME_OVER && actions < maxActions) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) throw new Error(`No legal action at ${actions}: ${ids.join(' vs ')}`);
    const action = chooseBaselineAction(adapter, player, policyRng[player]);
    if (action === null || !legal.includes(action)) throw new Error(`Illegal action ${action} at ${actions}: ${ids.join(' vs ')}`);
    if (ids[player] === 'homura' && action === ACTIONS.SPECIAL) {
      homuraSpecialSeat = player;
      homuraSpecialTurn = engine.state.turn;
    }
    adapter.applyAction(action, player);
    actions++;
  }

  const winner = engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null;
  const homuraSeat = ids.indexOf('homura');
  const homuraWin = winner === homuraSeat;
  const homuraOtkWin = homuraWin
    && homuraSpecialSeat === homuraSeat
    && homuraSpecialTurn === engine.state.turn
    && engine.state.homuraChainLockTurn === homuraSpecialTurn;

  return {
    winner,
    truncated: engine.state.phase !== PHASES.GAME_OVER,
    homuraWin,
    homuraOtkWin,
    homuraNonOtkWin: homuraWin && !homuraOtkWin,
    homuraSpecialUsed: homuraSpecialSeat === homuraSeat,
  };
}

const standings = Object.fromEntries(roster.map(id => [id, {
  character: id, games: 0, wins: 0, losses: 0, draws: 0, truncated: 0,
  homuraOtkWins: 0, homuraNonOtkWins: 0, homuraSpecialGames: 0,
}]));
const rows = [];
let pairIndex = 0;
for (let a = 0; a < roster.length; a++) {
  for (let b = a + 1; b < roster.length; b++) {
    const first = roster[a], second = roster[b];
    const half = Math.floor(gamesPerPair / 2);
    let firstWins = 0, secondWins = 0, draws = 0, truncated = 0;
    let homuraOtkWins = 0, homuraNonOtkWins = 0, homuraSpecialGames = 0;

    for (let i = 0; i < half; i++) {
      const result = play([first, second], 2026091550 + pairIndex * 10000 + i);
      if (result.truncated) truncated++;
      if (result.winner === 0) firstWins++; else if (result.winner === 1) secondWins++; else draws++;
      homuraOtkWins += result.homuraOtkWin ? 1 : 0;
      homuraNonOtkWins += result.homuraNonOtkWin ? 1 : 0;
      homuraSpecialGames += result.homuraSpecialUsed ? 1 : 0;
    }
    for (let i = 0; i < gamesPerPair - half; i++) {
      const result = play([second, first], 2026091550 + pairIndex * 10000 + 5000 + i);
      if (result.truncated) truncated++;
      if (result.winner === 1) firstWins++; else if (result.winner === 0) secondWins++; else draws++;
      homuraOtkWins += result.homuraOtkWin ? 1 : 0;
      homuraNonOtkWins += result.homuraNonOtkWin ? 1 : 0;
      homuraSpecialGames += result.homuraSpecialUsed ? 1 : 0;
    }

    rows.push({
      first, second, games: gamesPerPair, firstWins, secondWins, draws, truncated,
      firstWinRate: firstWins / gamesPerPair, secondWinRate: secondWins / gamesPerPair,
      homuraOtkWins, homuraNonOtkWins, homuraSpecialGames,
    });
    standings[first].games += gamesPerPair;
    standings[first].wins += firstWins;
    standings[first].losses += secondWins;
    standings[first].draws += draws;
    standings[first].truncated += truncated;
    standings[second].games += gamesPerPair;
    standings[second].wins += secondWins;
    standings[second].losses += firstWins;
    standings[second].draws += draws;
    standings[second].truncated += truncated;
    if (first === 'homura' || second === 'homura') {
      standings.homura.homuraOtkWins += homuraOtkWins;
      standings.homura.homuraNonOtkWins += homuraNonOtkWins;
      standings.homura.homuraSpecialGames += homuraSpecialGames;
    }
    pairIndex++;
  }
}

const table = Object.values(standings)
  .map(item => ({ ...item, winRate: item.wins / item.games }))
  .sort((a, b) => b.winRate - a.winRate || a.character.localeCompare(b.character));

console.log('HOMURA_OTK_ROUNDROBIN=' + JSON.stringify({
  gamesPerPair,
  seatSplit: [Math.floor(gamesPerPair / 2), gamesPerPair - Math.floor(gamesPerPair / 2)],
  pairs: rows.length,
  totalGames: rows.reduce((s, row) => s + row.games, 0),
  rows,
  standings: table,
  homura: standings.homura,
}));
