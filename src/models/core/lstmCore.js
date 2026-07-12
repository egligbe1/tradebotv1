/**
 * lstmCore.js — environment-agnostic LSTM training/inference.
 *
 * The caller passes its own TensorFlow instance (`@tensorflow/tfjs` in the
 * browser, `@tensorflow/tfjs-node` in CI), so the identical topology, scaling,
 * class-weighting, purged split and early-stopping logic run in both places.
 *
 * Key correctness fixes vs the previous implementation:
 *   • 3-class SOFTMAX (DOWN / NEUTRAL / UP) instead of a long-only binary that
 *     was being read as a symmetric buy/sell.
 *   • features standardized with a scaler fit on the TRAIN slice only, and the
 *     scaler is returned so it can be persisted with the weights.
 *   • purge+embargo between train and validation to stop label leakage.
 *   • class weights + early stopping (restore best weights) to fight the heavy
 *     class imbalance and overfitting from a fixed 50-epoch run.
 */

import { fitScaler, applyScaler } from '../../lib/scaler.js';
import { FEATURE_NAMES, LOOKBACK } from '../../lib/featureContract.js';
import { buildSequences, chronoSplitBounds, computeClassWeights } from './dataset.js';

export const N_CLASSES = 3;

export function buildLstmModel(tf, nFeatures = FEATURE_NAMES.length, lookback = LOOKBACK) {
  const model = tf.sequential();
  model.add(tf.layers.lstm({
    units: 48,
    returnSequences: true,
    inputShape: [lookback, nFeatures],
  }));
  model.add(tf.layers.dropout({ rate: 0.25 }));
  model.add(tf.layers.lstm({ units: 24, returnSequences: false }));
  model.add(tf.layers.dropout({ rate: 0.25 }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: N_CLASSES, activation: 'softmax' }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  return model;
}

function scaleSequences(X3d, scaler) {
  return X3d.map((seq) => seq.map((r) => applyScaler(r, scaler)));
}

/**
 * Full training pipeline. Returns the trained model plus the fitted scaler.
 * @param {*} tf                 TensorFlow instance
 * @param {Array} features       feature rows from FeatureEngine
 * @param {object} opts
 * @returns {{model, scaler, valSize:number, seqCount:number}}
 */
export async function trainSequenceModel(tf, features, opts = {}) {
  const { onEpoch = null, epochs = 60, batchSize = 64 } = opts;

  const { X, y } = buildSequences(features);
  if (X.length < 150) {
    throw new Error(`Insufficient sequences (${X.length}); need at least 150. Fetch more history.`);
  }

  const { trainEnd, valStart } = chronoSplitBounds(X.length, 0.8);
  const trainX = X.slice(0, trainEnd);
  const trainY = y.slice(0, trainEnd);
  const valX = X.slice(valStart);
  const valY = y.slice(valStart);

  // Fit the scaler on training timesteps only (no leakage from the val slice).
  const flat = [];
  for (const seq of trainX) for (const r of seq) flat.push(r);
  const scaler = fitScaler(flat);

  const sTrainX = scaleSequences(trainX, scaler);
  const sValX = scaleSequences(valX, scaler);

  const classWeight = computeClassWeights(trainY, N_CLASSES);
  const model = buildLstmModel(tf, FEATURE_NAMES.length, LOOKBACK);

  const xTrainT = tf.tensor3d(sTrainX);
  const yTrainT = tf.oneHot(tf.tensor1d(trainY, 'int32'), N_CLASSES);
  const xValT = tf.tensor3d(sValX);
  const yValT = tf.oneHot(tf.tensor1d(valY, 'int32'), N_CLASSES);

  // Early stopping + best-weight restore, implemented as ONE plain-object
  // callback. We must not mix a plain object with a tf.callbacks.* instance in
  // the callbacks array — TF.js calls setParams() on each entry and plain
  // objects lack it ("callback.setParams is not a function"). A single custom
  // callback is wrapped correctly by TF.js, and we halt via model.stopTraining
  // (tf.callbacks.earlyStopping's restoreBestWeights isn't implemented here).
  const PATIENCE = 6;
  let bestValLoss = Infinity;
  let bestWeights = null;
  let wait = 0;
  const callback = {
    onEpochEnd: (epoch, logs) => {
      if (onEpoch) onEpoch(epoch, logs);
      const vl = logs.val_loss;
      if (vl !== undefined && vl < bestValLoss - 1e-4) {
        bestValLoss = vl;
        wait = 0;
        if (bestWeights) bestWeights.forEach((w) => w.dispose());
        bestWeights = model.getWeights().map((w) => w.clone());
      } else {
        wait += 1;
        if (wait >= PATIENCE) model.stopTraining = true;
      }
    },
  };

  let metrics = { valAccuracy: 0, confusion: null, bestValLoss: null };
  try {
    await model.fit(xTrainT, yTrainT, {
      epochs,
      batchSize,
      validationData: [xValT, yValT],
      shuffle: false, // never shuffle time series
      classWeight,
      callbacks: callback,
    });

    if (bestWeights) {
      model.setWeights(bestWeights);
      bestWeights.forEach((w) => w.dispose());
      bestWeights = null;
    }

    // Honest out-of-sample metrics (accuracy + confusion) on the val slice,
    // plus the raw P(up) column + up/down outcomes for probability calibration.
    metrics = tf.tidy(() => {
      const preds = model.predict(xValT);
      const flat = preds.dataSync(); // row-major [n × 3]
      const predClass = preds.argMax(-1).dataSync();
      const confusion = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const valProbsUp = new Array(valY.length);
      const valYup = new Array(valY.length);
      let correct = 0;
      for (let i = 0; i < valY.length; i++) {
        confusion[valY[i]][predClass[i]]++;
        if (predClass[i] === valY[i]) correct++;
        valProbsUp[i] = flat[i * 3 + 2]; // class index 2 = UP
        valYup[i] = valY[i] === 2 ? 1 : 0;
      }
      return {
        valAccuracy: valY.length ? correct / valY.length : 0,
        confusion,
        bestValLoss: Number.isFinite(bestValLoss) ? bestValLoss : null,
        valProbsUp,
        valYup,
      };
    });
  } finally {
    if (bestWeights) bestWeights.forEach((w) => w.dispose());
    xTrainT.dispose();
    yTrainT.dispose();
    xValT.dispose();
    yValT.dispose();
  }

  return { model, scaler, valSize: valX.length, seqCount: X.length, metrics };
}

/**
 * Predict class probabilities [pDown, pNeutral, pUp] for one sequence of raw
 * feature vectors (length LOOKBACK).
 */
export function predictSequenceProba(tf, model, scaler, seqRows) {
  return tf.tidy(() => {
    const scaled = seqRows.map((r) => applyScaler(r, scaler));
    const out = model.predict(tf.tensor3d([scaled]));
    return Array.from(out.dataSync());
  });
}
