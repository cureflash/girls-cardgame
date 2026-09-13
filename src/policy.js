import { rlSpec } from './rl-adapter.js';

// The exported MaskablePPO actor runs locally. No game state or file leaves the browser.
export class Policy {
  constructor(data) {
    const spec = rlSpec();
    if (data.format !== 'girls-cardgame-mlp-v1' || data.rulesVersion !== spec.rulesVersion
      || data.observationSize !== spec.observationSize || data.actionCount !== spec.actionCount)
      throw new Error('このAIは現在のルールに対応していません。最新コードで再学習・書き出してください。');
    if (!Array.isArray(data.layers) || data.layers.length < 1 || data.layers.length > 8) throw new Error('AIファイルの層が不正です。');
    let input = spec.observationSize;
    this.layers = data.layers.map((layer, i) => {
      if (!Array.isArray(layer.bias) || !Array.isArray(layer.weights) || layer.bias.length > 2048
        || !layer.bias.length || layer.weights.length !== layer.bias.length
        || !['tanh', 'relu', 'linear'].includes(layer.activation)
        || (i === data.layers.length - 1 && layer.activation !== 'linear')) throw new Error('AIファイルの形式が不正です。');
      if (!layer.bias.every(Number.isFinite) || layer.weights.some(row => !Array.isArray(row) || row.length !== input || !row.every(Number.isFinite))) throw new Error('AIの重みが不正です。');
      input = layer.bias.length;
      return { activation: layer.activation, bias: Float64Array.from(layer.bias), weights: layer.weights.map(row => Float64Array.from(row)) };
    });
    if (input !== spec.actionCount) throw new Error('AIの出力サイズが不正です。');
  }
  logits(observation) {
    let values = observation;
    for (const layer of this.layers) {
      values = layer.weights.map((row, i) => {
        let value = layer.bias[i];
        for (let j = 0; j < row.length; j++) value += row[j] * values[j];
        return layer.activation === 'tanh' ? Math.tanh(value) : layer.activation === 'relu' ? Math.max(0, value) : value;
      });
    }
    if (values.some(value => !Number.isFinite(value))) throw new Error('AIの計算結果が不正です。');
    return values;
  }
  choose(observation, legal) {
    if (!legal.length) throw new Error('No legal actions.');
    const logits = this.logits(observation);
    return legal.reduce((best, action) => logits[action] > logits[best] ? action : best, legal[0]);
  }
}
