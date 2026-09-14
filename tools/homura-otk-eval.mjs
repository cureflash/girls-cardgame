import { GameEngine, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';
import { ACTIONS } from '../src/rl-adapter.js';

const opponents = ['madoka', 'mami', 'sayaka', 'kyoko', 'nagisa'];
const gamesPerOpponent = Number(process.env.GAMES ?? process.argv[2] ?? 100);
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
  const homuraSeat = ids.indexOf('homura');
  let actions = 0;
  let specialTurn = null;

  while (engine.state.phase !== PHASES.GAME_OVER && actions < maxActions) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) throw new Error(`No legal action at ${actions}: ${ids.join(' vs ')}`);
    const action = chooseBaselineAction(adapter, player, policyRng[player]);
    if (action === null || !legal.includes(action)) throw new Error(`Illegal action ${action} at ${actions}: ${ids.join(' vs ')}`);
    if (player === homuraSeat && action === ACTIONS.SPECIAL) specialTurn = engine.state.turn;
    adapter.applyAction(action, player);
    actions++;
  }

  const winner = engine.state.phase === PHASES.GAME_OVER ? engine.state.winner : null;
  const homuraWin = winner === homuraSeat;
  const sameTurnSpecialWin = homuraWin && specialTurn !== null && specialTurn === engine.state.turn;
  return {
    winner,
    truncated: engine.state.phase !== PHASES.GAME_OVER,
    homuraWin,
    homuraOtkWin: sameTurnSpecialWin,
    homuraNonOtkWin: homuraWin && !sameTurnSpecialWin,
    homuraSpecialUsed: specialTurn !== null,
  };
}

const rows = [];
const total = { games: 0, wins: 0, losses: 0, draws: 0, truncated: 0, otkWins: 0, nonOtkWins: 0, specialGames: 0 };
for (let o = 0; o < opponents.length; o++) {
  const opponent = opponents[o];
  const half = Math.floor(gamesPerOpponent / 2);
  const row = { opponent, games: gamesPerOpponent, wins: 0, losses: 0, draws: 0, truncated: 0, otkWins: 0, nonOtkWins: 0, specialGames: 0 };
  for (let i = 0; i < gamesPerOpponent; i++) {
    const homuraFirst = i < half;
    const ids = homuraFirst ? ['homura', opponent] : [opponent, 'homura'];
    const result = play(ids, 2026091556 + o * 10000 + i);
    row.truncated += result.truncated ? 1 : 0;
    row.otkWins += result.homuraOtkWin ? 1 : 0;
    row.nonOtkWins += result.homuraNonOtkWin ? 1 : 0;
    row.specialGames += result.homuraSpecialUsed ? 1 : 0;
    if (result.homuraWin) row.wins++;
    else if (result.winner === null) row.draws++;
    else row.losses++;
  }
  row.winRate = row.wins / row.games;
  row.specialRate = row.specialGames / row.games;
  rows.push(row);
  for (const key of ['games', 'wins', 'losses', 'draws', 'truncated']) total[key] += row[key];
  total.otkWins += row.otkWins;
  total.nonOtkWins += row.nonOtkWins;
  total.specialGames += row.specialGames;
}
total.winRate = total.wins / total.games;
total.specialRate = total.specialGames / total.games;

console.log('HOMURA_OTK_EVAL=' + JSON.stringify({
  gamesPerOpponent,
  seatSplit: [Math.floor(gamesPerOpponent / 2), gamesPerOpponent - Math.floor(gamesPerOpponent / 2)],
  total,
  rows,
}));
