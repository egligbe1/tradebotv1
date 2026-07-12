/**
 * walkforward.js — purged, embargoed walk-forward validation.
 *
 * A single 80/20 split gives one lucky/unlucky estimate; a naive k-fold leaks
 * because our labels look HORIZON bars into the future. This does expanding-
 * window walk-forward with an embargo gap between each training window and its
 * test fold, so no training row's forward-looking label overlaps the test
 * period (López de Prado). The concatenated out-of-sample predictions are the
 * honest basis for both calibration and skill weighting.
 */

import { LABEL } from '../../lib/featureContract.js';

/**
 * Generate expanding-window walk-forward folds.
 * @returns {Array<{trainEnd:number, testStart:number, testEnd:number}>}
 */
export function walkForwardSplits(n, { folds = 4, embargo = LABEL.HORIZON, minTrainFrac = 0.4 } = {}) {
  const firstTest = Math.floor(n * minTrainFrac);
  const testTotal = n - firstTest;
  if (testTotal < folds) return [];
  const foldSize = Math.floor(testTotal / folds);
  const splits = [];
  for (let k = 0; k < folds; k++) {
    const testStart = firstTest + k * foldSize;
    const testEnd = k === folds - 1 ? n : testStart + foldSize;
    const trainEnd = Math.max(0, testStart - embargo);
    splits.push({ trainEnd, testStart, testEnd });
  }
  return splits;
}

/**
 * Collect concatenated out-of-sample predictions across walk-forward folds.
 * @param {number[][]} X          feature rows
 * @param {Array} yFit            labels used to TRAIN the model each fold
 * @param {number[]} yEval        binary outcome (0/1) used to score OOS preds
 * @param {object} cfg
 * @param {(xt:number[][], yt:any[]) => any} cfg.fit   returns a fitted predictor
 * @param {(m:any, x:number[]) => number} cfg.proba    P(up) for one row
 * @returns {{scores:number[], y:number[], folds:number}}
 */
export function walkForwardOOS(X, yFit, yEval, cfg) {
  const { fit, proba, folds = 4, embargo = LABEL.HORIZON, minTrainFrac = 0.4, minTrain = 40 } = cfg;
  const splits = walkForwardSplits(X.length, { folds, embargo, minTrainFrac });
  const scores = [];
  const y = [];
  for (const s of splits) {
    if (s.trainEnd < minTrain) continue;
    const model = fit(X.slice(0, s.trainEnd), yFit.slice(0, s.trainEnd));
    for (let i = s.testStart; i < s.testEnd; i++) {
      scores.push(proba(model, X[i]));
      y.push(yEval[i]);
    }
  }
  return { scores, y, folds: splits.length };
}

/** Summary OOS metrics for reporting. */
export function oosMetrics(scores, y) {
  const n = y.length;
  if (!n) return { n: 0, accuracy: 0, logLoss: 0 };
  let correct = 0;
  let ll = 0;
  const eps = 1e-6;
  for (let i = 0; i < n; i++) {
    const p = Math.min(1 - eps, Math.max(eps, scores[i]));
    if ((p >= 0.5 ? 1 : 0) === y[i]) correct++;
    ll += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
  }
  return { n, accuracy: correct / n, logLoss: ll / n };
}
