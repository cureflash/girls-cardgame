# Magical Duel Prototype

ブラウザで動く中央集権型カードゲーム試作。

## 確定済み仕様

- デッキ = ライフ。デッキが先に尽きた側が敗北。
- モンスターゾーンは各5枠。使い魔と魔女で共用。
- 使い魔は基本モンスター。
- 魔女は使い魔を生贄にし、生贄の攻撃値合計がカードごとの閾値以上なら召喚可能。
- 戦闘中、チェーン可能な魔法がある場合は必ずポップアップで確認する。
- 先攻1ターン目は攻撃不可。
- ダメージを受けたらその枚数をデッキからめくり、`ceil(damage / 3)` 枚を手札、残りを墓地へ送る。
- 鹿目まどか: 戦闘ダメージを常に1軽減。
- 巴マミ: 初期手札+1枚。
- 必殺技は優先権があれば何度でも発動可能。必殺技にはチェーン不可。
- ティロ・フィナーレ: フィールドの使い魔・魔女を全破壊。
- プルウィア☆マギカ: 自分の墓地の使い魔・魔女から1体を自分フィールドへ蘇生。

## 中央集権構成

`GameEngine` が唯一のルール authority。UI と強化学習AIは `GameEngine` を直接改変せず、コマンド経由で操作する。

## 画像差し替え

カード・キャラクター画像パスは `src/card-data.js` に集約。

- `assets/cards/`
- `assets/characters/madoka.webp`
- `assets/characters/mami.webp`

## 起動

```bash
python -m http.server 8000
```

`http://localhost:8000/` を開く。

## テスト

```bash
npm test
```

## 強化学習

強化学習は既存 `GameEngine` の上に `src/rl-adapter.js` を置き、合法手だけを action mask として `MaskablePPO` に渡す。相手の手札内容やデッキ順は観測に含めない。

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

評価では勝率に加え、序盤被ダメージ、`3n+1` ダメージの割合、魔女召喚回数、チェーン使用回数、必殺技使用回数などを集計する。

## RL構成

```text
src/game-engine.js   ルールの唯一のauthority
src/rl-adapter.js    状態ベクトル・固定行動ID・action mask
rl/server.mjs        Node側ヘッドレス対戦サーバー
rl/env.py            Gymnasium環境
rl/train.py          MaskablePPO自己対戦
rl/evaluate.py       勝率・戦略統計
```

## 未確定のため固定していないもの

- ♦ / ♣ に相当する旧トランプ版固有能力
- 魔法カードの最終カードプール
- 正式な魔女・使い魔のカード割り当て
- 初期手札枚数や通常ドロー枚数など、会話で未確定の数値

試作用カード割り当ては `src/card-data.js` のみで差し替えられる。
