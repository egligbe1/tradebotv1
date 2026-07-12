/**
 * rfCore.js — environment-agnostic Random Forest training/inference.
 *
 * Random Forests are scale-invariant, so no scaler is needed. The important
 * fixes vs before:
 *   • trains on the 3-class DIRECTIONAL target (down/flat/up),
 *   • returns REAL class probabilities via `predictProbability` instead of the
 *     hardcoded 0.68 / 0.32 the old code emitted.
 */

import { RandomForestClassifier as RFClassifier } from 'ml-random-forest';

export const RF_OPTIONS = {
  seed: 42,
  replacement: true,
  nEstimators: 120,
  maxFeatures: 0.7,
  treeOptions: { maxDepth: 8, minNumSamples: 8 },
};

/**
 * @param {number[][]} X
 * @param {number[]} y  3-class directional labels (0/1/2)
 * @returns {object} serializable model JSON
 */
export function trainRandomForest(X, y, options = RF_OPTIONS) {
  if (X.length < 50) throw new Error('rfCore: need at least 50 rows to train.');
  const model = new RFClassifier(options);
  model.train(X, y);
  return model.toJSON();
}

export function loadRandomForest(json) {
  return RFClassifier.load(json);
}

/**
 * Class probabilities [pDown, pNeutral, pUp] for one feature vector.
 * @param {RFClassifier} model  a loaded RF model instance
 */
export function predictRfProba(model, vec) {
  const p = new Array(3);
  for (let c = 0; c < 3; c++) {
    // predictProbability returns one value per input row; we pass a single row.
    p[c] = model.predictProbability([vec], c)[0];
  }
  const sum = p[0] + p[1] + p[2];
  if (sum > 0) for (let c = 0; c < 3; c++) p[c] /= sum;
  return p;
}
