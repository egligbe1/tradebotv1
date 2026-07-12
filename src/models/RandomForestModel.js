import { useStore } from '@/store/useStore';
import { syncManager } from '@/services/SyncManager';
import { rowToVector, LABEL } from '@/lib/featureContract';
import { buildTabular } from '@/models/core/dataset';
import { trainRandomForest, loadRandomForest, predictRfProba } from '@/models/core/rfCore';
import { fitCalibrator, calibrate } from '@/models/core/calibration';
import { brierSkill } from '@/models/core/ensemble';
import { walkForwardOOS } from '@/models/core/walkforward';

const UP_BAND = 0.42;   // P(up) share needed to vote BUY
const DOWN_BAND = 0.42; // P(down) share needed to vote SELL

export class RandomForestModel {
  name = 'RandomForestModel';
  model = null;      // loaded RFClassifier instance
  calibrator = null;
  skill = null;
  isTrained = false;

  getStorageKey(symbolOverride = null) {
    const symbol = symbolOverride || useStore.getState().symbol || 'EUR/USD';
    return `tradebot_rf_${symbol.replace('/', '').toLowerCase()}`;
  }

  async saveToLocal(payload, symbolOverride = null) {
    try {
      localStorage.setItem(this.getStorageKey(symbolOverride), JSON.stringify(payload));
      const symbol = symbolOverride || useStore.getState().symbol;
      await syncManager.uploadModel(symbol, 'randomforest', payload);
    } catch (e) {
      console.error('[RandomForestModel] Save failed:', e.message);
    }
  }

  async loadFromLocal(cloudWeights = null) {
    try {
      let payload = cloudWeights;
      if (!payload) {
        const saved = localStorage.getItem(this.getStorageKey());
        if (!saved) return false;
        payload = JSON.parse(saved);
      }
      // Wrapper shape { model, calibrator, skill }; fall back to raw json.
      const json = payload.model ? payload.model : payload;
      this.model = loadRandomForest(json);
      this.calibrator = payload.calibrator || null;
      this.skill = payload.skill ?? null;
      this.isTrained = true;
      if (cloudWeights) localStorage.setItem(this.getStorageKey(), JSON.stringify(payload));
      console.log('[RandomForestModel] Loaded weights.');
      return true;
    } catch (e) {
      console.error('[RandomForestModel] Load failed:', e.message);
      return false;
    }
  }

  async train(featuresArr, symbolOverride = null) {
    const { X, y } = buildTabular(featuresArr);
    if (X.length < 80) throw new Error(`Not enough clean data to train Random Forest (${X.length}).`);

    // Walk-forward OOS (train on 3-class labels, score P(up) vs up-outcome).
    const yUp = y.map((v) => (v === LABEL.UP ? 1 : 0));
    const wf = walkForwardOOS(X, y, yUp, {
      fit: (xt, yt) => loadRandomForest(trainRandomForest(xt, yt)),
      proba: (m, v) => predictRfProba(m, v)[2],
    });
    this.calibrator = fitCalibrator(wf.scores, wf.y);
    this.skill = brierSkill(wf.scores, wf.y);

    // Deploy a model on all data except the last (leaky) HORIZON labels.
    const deployEnd = Math.max(60, X.length - LABEL.HORIZON);
    const json = trainRandomForest(X.slice(0, deployEnd), y.slice(0, deployEnd));
    this.model = loadRandomForest(json);

    this.isTrained = true;
    console.log(`[RandomForestModel] Trained (${deployEnd} rows), OOS skill=${(this.skill ?? 0).toFixed(3)}.`);
    await this.saveToLocal({ model: json, calibrator: this.calibrator, skill: this.skill }, symbolOverride);
  }

  /** @returns {{signal, probability, skill, probs:[pDown,pNeutral,pUp]}} */
  predict(latestRow) {
    if (!this.isTrained || !this.model) return { signal: 'HOLD', probability: 0.5, skill: null, probs: [1 / 3, 1 / 3, 1 / 3] };
    const probs = predictRfProba(this.model, rowToVector(latestRow));
    const [pDown, , pUpRaw] = probs;
    const pUp = calibrate(this.calibrator, pUpRaw);
    let signal = 'HOLD';
    if (pUpRaw >= UP_BAND && pUpRaw > pDown) signal = 'BUY';
    else if (pDown >= DOWN_BAND && pDown > pUpRaw) signal = 'SELL';
    return { signal, probability: pUp, skill: this.skill, probs };
  }
}
