# Magical Duel Prototype

ブラウザで動く中央集権型カードゲーム試作。

## 確定済み仕様

- デッキ = ライフ。デッキが先に尽きた側が敗北。
- モンスターゾーンは各5枠。使い魔と魔女で共用。
- 使い魔は基本モンスター。
- 魔女は場の使い魔・魔女と手札の使い魔を生贄にし、生贄の攻撃値合計がカードごとの閾値以上なら召喚可能。手札の魔女は生贄にできない。
- ターンは `MAIN → BATTLE_START → BATTLE` を基本遷移とする。
- 召喚とメイン用魔法は `MAIN`、攻撃は `BATTLE` で行う。
- 必殺技は `BATTLE_START` でのみ発動可能で、各キャラ1デュエル1回。
- まどか・マミ・さやか・杏子の必殺技は解決後にバトルをスキップしてターン終了。
- ほむらは必殺技使用後もそのまま `BATTLE` へ進める。発動ターン中は相手だけチェーン不可で、ほむら側は強化魔法を使用可能。
- 戦闘中、チェーン可能な魔法がある場合は確認ウィンドウを開く。チェーン解決後は `BATTLE` に復帰する。
- 先攻1ターン目は攻撃不可。
- ダメージを受けたらその枚数をデッキからめくり、`ceil(damage / 3)` 枚を手札、残りを墓地へ送る。
- 盾は直接攻撃では使用不可。戦闘参加中の自分の使い魔・魔女を守り、自分の戦闘ダメージを0にし、チェーンとそのバトルフェイズを終了する。

### キャラクター

- 鹿目まどか: 初期手札5。戦闘ダメージを常に1軽減。`プルウィア☆マギカ` で墓地の使い魔・魔女1体を蘇生。
- 巴マミ: 初期手札4（−1）。`ティロ・フィナーレ` で相手フィールドの使い魔・魔女を全破壊。
- 美樹さやか: 初期手札5。魔女召喚の生贄必要値を3減らす（印刷値8/10/13は実効5/7/10）。必殺技で墓地の任意3枚をデッキへ戻し、デッキ全体をシャッフル。
- 佐倉杏子: 初期手札5。常時スキルなし。必殺技で相手の使い魔・魔女を1体だけ自分の魔女召喚の生贄に含め、不足分を自分の通常生贄で補う。
- 暁美ほむら: 初期手札5。攻撃アップ魔法の効果量を常に印刷値＋2として扱う。必殺技は発動ターン中の相手チェーンを禁止し、発動後もバトル続行可能。
- 百江なぎさ: 初期手札5。自分の使い魔が戦闘で破壊される場合、1ターンに1度だけ手札へ戻す。必殺技 `強制戦闘` では自分・相手フィールドの使い魔・魔女を順番に操作して各1回ずつ強制攻撃させられる。相手フィールドが1体だけの場合は、その1体を操作して相手へ直接攻撃できる。強制戦闘では防御側は攻撃アップ・盾を使えず、なぎさ側だけが使用できる。

## デッキ外観

キャラクター能力とカード画像セットは分離している。

- プレイヤー側はキャラクターに関係なく、常に `救済の魔女` を含むまどか側画像セットを使用。
- CPU/NPC側はキャラクターに関係なく、常に `ワルプルギスの夜` を含むマミ側画像セットを使用。
- 両デッキの機械的な30枚構成・攻撃力・効果・枚数は同一。

## 中央集権構成

ブラウザは `src/character-engine.js` を6キャラ共通のルール入口、`src/character-adapter.js` を6キャラ共通のAI/UIアダプタ入口として使用する。既存解析スクリプトとの互換性のため、内部実装の旧ファイル名は残している。

UI とAIは状態を直接変更せず、エンジンの合法手判定を参照し、公開コマンドを呼ぶ。

## 画像差し替え

カード・キャラクター画像パスは `src/card-data.js` に集約。

- `assets/cards/madoka/` — プレイヤー側モンスター・魔女画像
- `assets/cards/mami/` — NPC側モンスター・魔女画像
- `assets/characters/madoka.webp`
- `assets/characters/mami.webp`
- `assets/characters/sayaka.webp`
- `assets/characters/kyoko.webp`
- `assets/characters/homura.webp`
- `assets/characters/nagisa.webp`

## 起動

```bash
python -m http.server 8000
```

`http://localhost:8000/` を開く。

## テスト

```bash
npm test
```

6キャラのブラウザ統合回帰は、既存ファイル名を維持した `tests/five-character-browser.test.mjs` で、初期手札、顔グラ、プレイヤー/CPUの固定画像デッキ、同キャラ対戦時のカードID分離、共通エンジン/アダプタを検証する。

## 強化学習

強化学習はゲームエンジンの上にアダプタを置き、合法手だけを action mask として `MaskablePPO` に渡す。相手の手札内容やデッキ順は観測に含めない。

フェイズ制約もRL側で再実装せず、エンジンの `canSummon` / `canEnterBattlePhase` / `canContinueBattlePhase` / `canAttack` / `canUseSpecial` / `canEndTurn` などの判定結果だけを action mask に変換する。

報酬は勝利 `+1`、敗北 `-1`、途中 `0` のみ。手札補充やダメージなどへの補助報酬は入れていない。

### 1. ランダム同士で環境確認

```bash
npm run rl:random -- 100
```

### 2. Python環境

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r rl/requirements.txt
```

Linux/macOSでは仮想環境の有効化を `source .venv/bin/activate` に読み替える。

### 3. 自己対戦学習

```bash
python rl/train.py --generations 20 --steps-per-generation 100000
```

最初はランダムAIと対戦し、その後は過去8世代以内の保存済みpolicyから相手を選ぶ。モデルは `models/policy_XXX.zip` に保存される。

### 4. 評価

```bash
python rl/evaluate.py models/policy_019.zip --games 1000
```

別policyと戦わせる場合:

```bash
python rl/evaluate.py models/policy_019.zip --opponent models/policy_010.zip --games 1000
```

評価では勝率に加え、序盤被ダメージ、魔女召喚回数、チェーン使用回数、必殺技使用回数などを集計する。

## RL構成

```text
src/character-engine.js     6キャラ共通のルール入口
src/character-adapter.js    6キャラ共通のブラウザ/解析アダプタ入口
src/game-engine.js          基本ルール実装
src/rl-adapter.js           状態ベクトル・固定行動ID・action mask
rl/server.mjs               Node側ヘッドレス対戦サーバー
rl/env.py                   Gymnasium環境
rl/train.py                 MaskablePPO自己対戦
rl/evaluate.py              勝率・戦略統計
```
