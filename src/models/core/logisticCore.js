/**
 * logisticCore.js — self-contained binary logistic regression (browser + Node).
 *
 * Replaces `ml-logistic-regression`, which was used incorrectly across the
 * codebase: it stores weights as a `classifiers[]` array of Matrix objects and
 * exposes no `theta`, so the old code persisted `{weights: undefined,
 * theta: undefined}` and every logistic prediction was effectively random.
 *
 * This implementation:
 *   • trains on STANDARDIZED features (fit on the training slice only),
 *   • learns a genuine P(up) via sigmoid, so the ensemble gets real
 *     probabilities instead of a hardcoded 0.68/0.32,
 *   • serializes to plain JSON arrays (trivial to sync to Supabase).
 *
 * The label is directional: class UP=1 vs DOWN=0 (NEUTRAL rows are dropped),
 * making the output symmetric — high P(up) ⇒ BUY, low ⇒ SELL.
 */

import { fitScaler, applyScaler } from '../../lib/scaler.js';

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * @param {number[][]} X  raw (unscaled) feature rows
 * @param {number[]} y    binary labels (0/1)
 * @param {object} [opts]
 * @returns {{weights:number[], bias:number, scaler:object, l2:number}}
 */
export function trainLogistic(X, y, opts = {}) {
  const { epochs = 400, lr = 0.1, l2 = 1e-3 } = opts;
  if (!X.length) throw new Error('logisticCore: empty training set');

  const scaler = fitScaler(X);
  const Xs = X.map((r) => applyScaler(r, scaler));
  const n = Xs.length;
  const d = Xs[0].length;

  const w = new Array(d).fill(0);
  let b = 0;

  // Balanced class weights so a skewed up/down split doesn't bias the fit.
  const pos = y.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
  const neg = n - pos;
  const wPos = pos > 0 ? n / (2 * pos) : 1;
  const wNeg = neg > 0 ? n / (2 * neg) : 1;

  for (let e = 0; e < epochs; e++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const xi = Xs[i];
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * xi[j];
      const p = sigmoid(z);
      const sw = y[i] === 1 ? wPos : wNeg;
      const err = (p - y[i]) * sw;
      for (let j = 0; j < d; j++) gradW[j] += err * xi[j];
      gradB += err;
      wsum += sw;
    }
    const inv = 1 / (wsum || 1);
    for (let j = 0; j < d; j++) w[j] -= lr * (gradW[j] * inv + l2 * w[j]);
    b -= lr * gradB * inv;
  }

  return { weights: w, bias: b, scaler, l2 };
}

/** P(up) for a single raw feature vector using a trained model. */
export function predictLogisticProba(model, vec) {
  if (!model || !model.weights) return 0.5;
  const xs = applyScaler(vec, model.scaler);
  let z = model.bias;
  for (let j = 0; j < model.weights.length; j++) z += model.weights[j] * xs[j];
  return sigmoid(z);
}
