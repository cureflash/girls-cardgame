# 遺伝的アルゴリズムによる評価AI

この経路では、ニューラルネットの重みではなく、`src/evaluation-ai.js` に定義した解釈可能な評価項目の重みを遺伝子として進化させる。

## 何を学習するか

各合法手について、行動後を近似した盤面と即時効果を特徴量にする。主な項目は以下。

- 山札差、手札差、場の総攻撃力差、場の枚数差
- 魔女の戦力差
- 必殺技を温存している価値
- まどかの墓地蘇生ポテンシャル
- 与える/受けるダメージ
- 戦闘で除去する/失う戦力
- 召喚戦力、生贄コスト、ドロー
- ティロ・フィナーレで除去できる枚数/攻撃力
- 蘇生するカードの攻撃力、救済の魔女蘇生
- チェーンの攻撃力上昇、盾で救える戦力
- ターン終了、必殺技消費
- 勝利/敗北

AIは各合法手の `重み × 特徴量` の合計が最大になる手を選ぶ。学習結果のJSONを見れば、どの考え方を強く評価しているか人間が読める。

## 過適応を防ぐ仕組み

`ga/evolve.mjs` は次を標準で行う。

1. まどか先攻 / まどか後攻 / マミ先攻 / マミ後攻の4条件で対戦する。
2. 上位個体をエリートとして保存する。
3. 上位〜中位個体を通常交叉し、突然変異を加える。
4. 毎世代、完全ランダム個体を集団へ流入させる。
5. 毎世代、強個体と完全ランダム個体を直接交叉した子も作る。
6. 過去チャンピオンを Hall of Fame として残し、現世代と再戦させる。
7. fitness に使わない固定検証個体群を持ち、`validationScore` を別に記録する。
8. 集団の重みの標準偏差を `diversity` として記録し、戦略が一種類へ潰れていないか監視する。

fitness は勝ち=1、引き分け=0.5、負け=0だけで、特定カードを使うこと自体には報酬を付けない。

## まず短く動作確認

```bash
npm test
npm run ga:evolve -- --population 8 --generations 2 --opponents 3 --max-actions 400 --output models/ga-smoke
```

世代ごとにJSONが出る。

```text
models/ga-smoke/
  champion-000.json
  champion-001.json
  generation-000.json
  generation-001.json
  latest.json
  metrics.jsonl
```

## 本格学習例

```bash
npm run ga:evolve -- --population 24 --generations 50 --opponents 8 --repeats 2 --output models/ga
```

計算量を増やすなら、まず `population` と `opponents` を増やす。`repeats` は同じ組み合わせを異なる山札シャッフルで繰り返す回数。

### 再開

```bash
npm run ga:evolve -- --population 24 --generations 20 --opponents 8 --repeats 2 --output models/ga --resume models/ga/generation-049.json
```

## 評価

デフォルト評価AIを相手に400戦する例。

```bash
npm run ga:evaluate -- models/ga/latest.json --games 400
```

別個体と比較する場合。

```bash
npm run ga:evaluate -- models/ga/latest.json --opponent models/ga/champion-020.json --games 400
```

結果は `madoka-first / madoka-second / mami-first / mami-second` に分けて出る。

## ブラウザへ反映

```bash
npm run ga:publish -- models/ga/latest.json
```

これで `src/evolved-genome.js` が更新される。内容を確認してコミットすれば、ブラウザの標準AIがその評価重みを使う。

## 見るべき指標

`metrics.jsonl` では最低限、以下を確認する。

- `championFitness` が上がっているか
- `validationScore` も一緒に上がっているか
- `championFitness` だけ上がり `validationScore` が落ちていないか
- `diversity` が急に0へ近づいていないか

`championFitness ↑ / validationScore ↓` は、現世代やHall of Fameへ過適応している兆候。`diversity` の急低下は、ティロ即撃ちのような単一戦術へ集団全体が収束している兆候として扱う。
