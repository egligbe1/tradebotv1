import { useStore } from '@/store/useStore';
import { syncManager } from '@/services/SyncManager';
import { rowToVector, LABEL } from '@/lib/featureContract';
import { buildDirectionalBinary } from '@/models/core/dataset';
import { trainLogistic, predictLogisticProba } from '@/models/core/logisticCore';
import { fitCalibrator, calibrate } from '@/models/core/calibration';
import { brierSkill } from '@/models/core/ensemble';
import { walkForwardOOS } from '@/models/core/walkforward';

const UP_BAND = 0.58; // P(up) above this ⇒ BUY
const DOWN_BAND = 0.42; // P(up) below this ⇒ SELL

export class LogisticModel {
  name = 'LogisticModel';
  model = null;
  isTrained = false;

  getStorageKey(symbolOverride = null) {
    const symbol = symbolOverride || useStore.getState().symbol || 'EUR/USD';
    return `tradebot_logistic_${symbol.replace('/', '').toLowerCase()}`;
  }

  async saveToLocal(symbolOverride = null) {
    if (!this.model || !this.isTrained) return;
    try {
      localStorage.setItem(this.getStorageKey(symbolOverride), JSON.stringify(this.model));
      const symbol = symbolOverride || useStore.getState().symbol;
      await syncManager.uploadModel(symbol, 'logistic', this.model);
    } catch (e) {
      console.error('[LogisticModel] Save failed:', e.message);
    }
  }

  async loadFromLocal(cloudWeights = null) {
    try {
      let modelData = cloudWeights;
      if (!modelData) {
        const saved = localStorage.getItem(this.getStorageKey());
        if (!saved) return false;
        modelData = JSON.parse(saved);
      }
      if (!modelData || !Array.isArray(modelData.weights)) return false;
      this.model = modelData;
      this.isTrained = true;
      if (cloudWeights) localStorage.setItem(this.getStorageKey(), JSON.stringify(modelData));
      console.log('[LogisticModel] Loaded weights.');
      return true;
    } catch (e) {
      console.error('[LogisticModel] Load failed:', e.message);
      return false;
    }
  }

  async train(featuresArr, symbolOverride = null) {
    const { X, y } = buildDirectionalBinary(featuresArr);
    if (X.length < 80) {
      throw new Error(`Not enough directional rows to train Logistic (${X.length}); need 80+.`);
    }
    // Purged walk-forward OOS predictions → honest calibration + skill.
    const wf = walkForwardOOS(X, y, y, {
      fit: (xt, yt) => trainLogistic(xt, yt),
      proba: (m, v) => predictLogisticProba(m, v),
    });
    const calibrator = fitCalibrator(wf.scores, wf.y);
    const skill = brierSkill(wf.scores, wf.y);

    // Deploy a model trained on all data except the last (leaky) HORIZON labels.
    const deployEnd = Math.max(60, X.length - LABEL.HORIZON);
    const model = trainLogistic(X.slice(0, deployEnd), y.slice(0, deployEnd));
    model.calibrator = calibrator;
    model.skill = skill;

    this.model = model;
    this.isTrained = true;
    console.log(`[LogisticModel] Trained (${deployEnd} rows), OOS skill=${(skill ?? 0).toFixed(3)}.`);
    await this.saveToLocal(symbolOverride);
  }

  /** @returns {{signal, probability, skill}} probability = calibrated P(up) */
  predict(latestRow) {
    if (!this.isTrained || !this.model) return { signal: 'HOLD', probability: 0.5, skill: null };
    const raw = predictLogisticProba(this.model, rowToVector(latestRow));
    const pUp = calibrate(this.model.calibrator, raw);
    let signal = 'HOLD';
    if (pUp >= UP_BAND) signal = 'BUY';
    else if (pUp <= DOWN_BAND) signal = 'SELL';
    return { signal, probability: pUp, skill: this.model.skill ?? null };
  }
}
