import * as tf from '@tensorflow/tfjs';
import { useStore } from '@/store/useStore';
import { syncManager } from '@/services/SyncManager';
import { FEATURE_COUNT, LOOKBACK, rowToVector, rowIsComplete } from '@/lib/featureContract';
import { trainSequenceModel, predictSequenceProba } from '@/models/core/lstmCore';
import { fitCalibrator, calibrate } from '@/models/core/calibration';
import { brierSkill } from '@/models/core/ensemble';

// Probability band around 1/3 (chance level for 3 classes) that a directional
// class must clear before we treat it as a vote rather than noise.
const UP_THRESHOLD = 0.45;
const DOWN_THRESHOLD = 0.45;

const symKey = (symbolOverride = null) => {
  const symbol = symbolOverride || useStore.getState().symbol || 'EUR/USD';
  return symbol.replace('/', '').toLowerCase();
};
const getModelSavePath = (symbolOverride = null) => `indexeddb://${symKey(symbolOverride)}-lstm-model`;
const getScalerKey = (symbolOverride = null) => `tradebot_lstm_scaler_${symKey(symbolOverride)}`;

export class LSTMModel {
  constructor() {
    this.name = 'LSTMModel';
    this.model = null;
    this.scaler = null;
    this.calibrator = null;
    this.skill = null;
    this.isTrained = false;
  }

  _saveScalerLocal(symbolOverride = null) {
    try {
      localStorage.setItem(getScalerKey(symbolOverride), JSON.stringify({
        scaler: this.scaler, calibrator: this.calibrator, skill: this.skill,
        featureCount: FEATURE_COUNT, lookback: LOOKBACK,
      }));
    } catch (e) { console.warn('[LSTMModel] scaler save failed:', e.message); }
  }

  _loadScalerLocal(symbolOverride = null) {
    try {
      const raw = localStorage.getItem(getScalerKey(symbolOverride));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  _shapeMatches(model) {
    const expected = [null, LOOKBACK, FEATURE_COUNT];
    const actual = model.layers[0].batchInputShape;
    return actual && actual[1] === expected[1] && actual[2] === expected[2];
  }

  async loadModelFromDb(cloudWeights = null, symbolOverride = null) {
    try {
      if (cloudWeights) {
        // Cloud payload shape: { artifacts, scaler, featureCount, lookback }.
        const payload = cloudWeights.artifacts ? cloudWeights : { artifacts: cloudWeights, scaler: null };
        const loaded = await tf.loadLayersModel(tf.io.fromMemory(payload.artifacts));
        if (!this._shapeMatches(loaded)) {
          console.warn('[LSTMModel] Cloud model shape mismatch with current feature contract. Discarding.');
          loaded.dispose?.();
          return false;
        }
        this.model = loaded;
        this.model.compile({ optimizer: tf.train.adam(0.001), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
        this.scaler = payload.scaler || this._loadScalerLocal(symbolOverride)?.scaler || null;
        this.calibrator = payload.calibrator || null;
        this.skill = payload.skill ?? null;
        this.isTrained = true;
        await this.model.save(getModelSavePath(symbolOverride));
        this._saveScalerLocal(symbolOverride);
        console.log('[LSTMModel] Restored from cloud artifacts.');
        return true;
      }

      const loaded = await tf.loadLayersModel(getModelSavePath(symbolOverride));
      if (!this._shapeMatches(loaded)) {
        console.warn('[LSTMModel] Local model shape mismatch. Requires retrain.');
        loaded.dispose?.();
        this.model = null; this.isTrained = false;
        return false;
      }
      this.model = loaded;
      this.model.compile({ optimizer: tf.train.adam(0.001), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
      const stored = this._loadScalerLocal(symbolOverride);
      this.scaler = stored?.scaler || null;
      this.calibrator = stored?.calibrator || null;
      this.skill = stored?.skill ?? null;
      this.isTrained = true;
      if (!this.scaler) console.warn('[LSTMModel] Loaded model but no scaler found; predictions may be degraded until retrain.');
      console.log('[LSTMModel] Loaded existing weights from IndexedDB.');
      return true;
    } catch {
      console.log('[LSTMModel] No valid model in DB; requires training.');
      this.isTrained = false;
      return false;
    }
  }

  async train(featuresArr, onProgressCallback = () => {}, onStatsCallback = () => {}, symbolOverride = null) {
    console.log('[LSTMModel] Starting training...');
    const { model, scaler, valSize, seqCount, metrics } = await trainSequenceModel(tf, featuresArr, {
      onEpoch: (epoch, logs) => onProgressCallback(epoch, logs),
    });

    // Calibrate P(up) and measure genuine out-of-sample skill on the val slice.
    this.calibrator = fitCalibrator(metrics?.valProbsUp || [], metrics?.valYup || []);
    this.skill = brierSkill(metrics?.valProbsUp || [], metrics?.valYup || []);

    onStatsCallback({
      sequences: seqCount,
      validRows: featuresArr.length,
      valSize,
      valAccuracy: metrics?.valAccuracy ?? null,
      confusion: metrics?.confusion ?? null,
      skill: this.skill,
    });

    this.model = model;
    this.scaler = scaler;
    this.isTrained = true;

    await this.model.save(getModelSavePath(symbolOverride));
    this._saveScalerLocal(symbolOverride);
    console.log('[LSTMModel] Weights + scaler saved locally.');

    try {
      const symbol = symbolOverride || useStore.getState().symbol;
      const artifacts = await this.model.save(tf.io.withSaveHandler(async (a) => a));
      await syncManager.uploadModel(symbol, 'lstm', {
        artifacts, scaler: this.scaler, calibrator: this.calibrator, skill: this.skill,
        featureCount: FEATURE_COUNT, lookback: LOOKBACK,
      });
    } catch (e) {
      console.error('[LSTMModel] Cloud sync failed:', e.message);
    }
  }

  /** @returns {{signal, probability, skill, probs:[pDown,pNeutral,pUp]}} */
  predictSequence(recentFeatures) {
    if (!this.isTrained || !this.model || recentFeatures.length < LOOKBACK) {
      return { signal: 'HOLD', probability: 0.5, skill: this.skill, probs: [1 / 3, 1 / 3, 1 / 3] };
    }
    // Build the last LOOKBACK complete rows as raw feature vectors.
    const window = recentFeatures.slice(-LOOKBACK);
    if (window.length < LOOKBACK || !window.every(rowIsComplete)) {
      return { signal: 'HOLD', probability: 0.5, skill: this.skill, probs: [1 / 3, 1 / 3, 1 / 3] };
    }
    const seqRows = window.map(rowToVector);
    const probs = predictSequenceProba(tf, this.model, this.scaler, seqRows);
    const [pDown, , pUpRaw] = probs;
    const pUp = calibrate(this.calibrator, pUpRaw); // calibrated P(up)

    let signal = 'HOLD';
    if (pUp >= UP_THRESHOLD && pUpRaw > pDown) signal = 'BUY';
    else if ((1 - pUp) >= DOWN_THRESHOLD && pDown > pUpRaw) signal = 'SELL';

    return { signal, probability: pUp, skill: this.skill, probs };
  }
}
