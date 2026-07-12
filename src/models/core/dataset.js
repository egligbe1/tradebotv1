/**
 * dataset.js — shared dataset construction & leakage-safe splitting.
 *
 * Used by the browser models, cloud-train.js and sentinel.js so the exact same
 * feature vectors and labels are produced everywhere.
 */

import {
  FEATURE_NAMES, LOOKBACK, LABEL, rowToVector, rowIsComplete,
} from '../../lib/featureContract.js';

/** Tabular dataset for tree / linear models: 3-class directional target. */
export function buildTabular(features) {
  const X = [];
  const y = [];
  for (const row of features) {
    if (row.target_dir === null || row.target_dir === undefined) continue;
    if (!rowIsComplete(row)) continue;
    X.push(rowToVector(row));
    y.push(row.target_dir);
  }
  return { X, y };
}

/** Directional binary dataset (UP=1 vs DOWN=0), NEUTRAL rows dropped. */
export function buildDirectionalBinary(features) {
  const X = [];
  const y = [];
  for (const row of features) {
    if (row.target_dir === null || row.target_dir === undefined) continue;
    if (row.target_dir === LABEL.NEUTRAL) continue;
    if (!rowIsComplete(row)) continue;
    X.push(rowToVector(row));
    y.push(row.target_dir === LABEL.UP ? 1 : 0);
  }
  return { X, y };
}

/** Overlapping sequence dataset for the LSTM (contiguous, complete windows). */
export function buildSequences(features) {
  const X = [];
  const y = [];
  for (let i = LOOKBACK - 1; i < features.length; i++) {
    const last = features[i];
    if (last.target_dir === null || last.target_dir === undefined) continue;
    let ok = true;
    const seq = new Array(LOOKBACK);
    for (let j = 0; j < LOOKBACK; j++) {
      const row = features[i - LOOKBACK + 1 + j];
      if (!rowIsComplete(row)) { ok = false; break; }
      seq[j] = rowToVector(row);
    }
    if (!ok) continue;
    X.push(seq);
    y.push(last.target_dir);
  }
  return { X, y };
}

/**
 * Chronological train/val split with a purge+embargo gap so forward-looking
 * labels near the boundary don't leak from train into val (López de Prado).
 * @returns {{trainEnd:number, valStart:number}} index boundaries into the array
 */
export function chronoSplitBounds(n, trainFrac = 0.8) {
  const embargo = LOOKBACK + LABEL.HORIZON;
  const valStart = Math.floor(n * trainFrac);
  const trainEnd = Math.max(0, valStart - embargo);
  return { trainEnd, valStart };
}

/** Inverse-frequency class weights, normalized to mean 1. */
export function computeClassWeights(y, nClasses) {
  const counts = new Array(nClasses).fill(0);
  for (const v of y) counts[v] = (counts[v] || 0) + 1;
  const total = y.length || 1;
  const weights = {};
  let sum = 0;
  for (let c = 0; c < nClasses; c++) {
    const w = counts[c] > 0 ? total / (nClasses * counts[c]) : 0;
    weights[c] = w;
    sum += w;
  }
  // Normalize so the average weight is ~1 (keeps loss magnitude comparable).
  const mean = sum / nClasses || 1;
  for (let c = 0; c < nClasses; c++) weights[c] = weights[c] / mean || 1;
  return weights;
}

export { FEATURE_NAMES, LOOKBACK, LABEL };
