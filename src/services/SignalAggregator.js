import { RuleEngine } from '@/models/RuleEngine';
import { LogisticModel } from '@/models/LogisticModel';
import { RandomForestModel } from '@/models/RandomForestModel';
import { LSTMModel } from '@/models/LSTMModel';
import { useStore } from '@/store/useStore';
import { syncManager } from '@/services/SyncManager';
import { priceDigits } from '@/lib/assetConfig';
import { fuseCalibrated } from '@/models/core/ensemble';
import { alignedModelNames, trendFilterText } from '@/lib/signalMessage';

// Ensemble P(up) must clear 0.5 ± CONVICTION_BAND to fire a directional signal.
const CONVICTION_BAND = 0.06;
// Minimum number of models that must independently agree on direction.
const MIN_CONSENSUS = 2;
// Stop-loss and take-profit sizing (ATR multiples). The stop sits just beyond
// the labelling barrier (1.2·ATR) so training payoff and live payoff align.
const SL_ATR_MULT = 1.5;
const RR = 2; // reward:risk for TP1
const RR2 = 3; // reward:risk for TP2

export class SignalAggregator {
  constructor() {
    this.models = {
      ruleEngine: new RuleEngine(),
      logistic: new LogisticModel(),
      randomForest: new RandomForestModel(),
      lstm: new LSTMModel(),
    };
    this.lastLstmSymbol = null;
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  async initializeLstm() {
    const symbol = useStore.getState().symbol || 'EUR/USD';
    const ok = await this.models.lstm.loadModelFromDb();
    if (!ok) {
      const weights = await syncManager.downloadModel(symbol, 'lstm');
      if (weights) await this.models.lstm.loadModelFromDb(weights);
    }
    this.lastLstmSymbol = symbol;
  }

  async initializeOtherModels() {
    const symbol = useStore.getState().symbol || 'EUR/USD';
    for (const mKey of ['logistic', 'randomForest']) {
      const model = this.models[mKey];
      const ok = await model.loadFromLocal();
      if (!ok) {
        const cloudKey = mKey === 'randomForest' ? 'randomforest' : mKey;
        const weights = await syncManager.downloadModel(symbol, cloudKey);
        if (weights) await model.loadFromLocal(weights);
      }
    }
  }

  async initializeAllModels() {
    await Promise.all([this.initializeLstm(), this.initializeOtherModels()]);
  }

  // ── Regime / context filters ────────────────────────────────────────────────

  _passesBuyFilter(row) {
    if (row.ms_structure === 'BEARISH') return false;             // don't buy a bearish structure
    if (row.trend_regime < -0.01) return false;                   // don't fight a strong down daily trend
    if (row.macro_trend === -1 && row.trend_regime < 0) return false; // macro + local both down
    return true;
  }

  _passesSellFilter(row) {
    if (row.ms_structure === 'BULLISH') return false;
    if (row.trend_regime > 0.01) return false;
    if (row.macro_trend === 1 && row.trend_regime > 0) return false;
    return true;
  }

  _passesRegimeFilter(row) {
    // Skip low-conviction chop: ADX below 18 = no trend to ride.
    if (row.adx !== null && row.adx !== undefined && row.adx < 18) return false;
    // Skip dead volatility (nothing to capture) — atr_norm ~ ATR/price.
    if (row.atr_norm !== null && row.atr_norm !== undefined && row.atr_norm < 0.0003) return false;
    return true;
  }

  // ── Ensemble fusion ─────────────────────────────────────────────────────────

  _fuse(preds, weights) {
    // Skill-weighted fusion of each model's CALIBRATED P(up): effective weight =
    // demonstrated out-of-sample skill × the user's preference weight. A model
    // no better than the base rate contributes ~nothing.
    const entries = Object.keys(preds).map((key) => ({
      key,
      p: preds[key].probability ?? 0.5,
      skill: preds[key].skill,
      userWeight: weights[key] ?? 0,
    }));
    const { pEns } = fuseCalibrated(entries);
    const bullVotes = Object.values(preds).filter((p) => p.signal === 'BUY').length;
    const bearVotes = Object.values(preds).filter((p) => p.signal === 'SELL').length;
    return { pEns, bullVotes, bearVotes };
  }

  _calcTradeParams(signal, entry, atr) {
    const risk = SL_ATR_MULT * atr;
    if (signal === 'BUY') return { sl: entry - risk, tp1: entry + RR * risk, tp2: entry + RR2 * risk };
    if (signal === 'SELL') return { sl: entry + risk, tp1: entry - RR * risk, tp2: entry - RR2 * risk };
    return { sl: 0, tp1: 0, tp2: 0 };
  }

  // ── Reason generation ────────────────────────────────────────────────────────

  _generateReasons(masterSignal, rulePred, row) {
    if (masterSignal === 'HOLD') return ['Market conditions neutral', 'Insufficient model consensus'];
    const r = [];
    const bull = masterSignal === 'BUY';
    if (bull && rulePred.reasonScore?.buyScore >= 1) r.push('Technical indicators show bullish momentum');
    if (!bull && rulePred.reasonScore?.sellScore >= 1) r.push('Technical indicators show bearish momentum');
    if (bull && row.rsi_bull_div === 1) r.push('Bullish RSI divergence detected');
    if (!bull && row.rsi_bear_div === 1) r.push('Bearish RSI divergence detected');
    if (row.trigger_engulfing === (bull ? 1 : -1)) r.push(`${bull ? 'Bullish' : 'Bearish'} engulfing pattern`);
    if (row.trigger_pinbar === (bull ? 1 : -1)) r.push(`${bull ? 'Bullish' : 'Bearish'} pin bar / rejection`);
    if (bull && row.dist_to_support !== null && row.dist_to_support < 0.001) r.push('Price testing local support');
    if (!bull && row.dist_to_resistance !== null && row.dist_to_resistance < 0.001) r.push('Price testing local resistance');
    if (row.adx !== null && row.adx > 25) r.push('Strong trend confirmed by ADX');
    r.push('Model ensemble consensus favors ' + (bull ? 'upside' : 'downside'));
    return r.slice(0, 3);
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  async generateSignal(features, currentPrice, macroCandles = null) {
    if (!features || features.length === 0) return null;

    if (macroCandles) {
      const { FeatureEngine } = await import('./FeatureEngine.js');
      FeatureEngine.enrichWithMacroTrend(features, macroCandles);
    }

    const weights = useStore.getState().modelWeights;
    const currentSymbol = useStore.getState().symbol;

    if (this.lastLstmSymbol !== currentSymbol) {
      await this.initializeAllModels();
      this.lastLstmSymbol = currentSymbol;
    }

    const row = features.at(-1);
    const preds = {
      ruleEngine: this.models.ruleEngine.predict(row),
      logistic: this.models.logistic.predict(row),
      randomForest: this.models.randomForest.predict(row),
      lstm: this.models.lstm.predictSequence(features),
    };

    const { pEns, bullVotes, bearVotes } = this._fuse(preds, weights);

    let masterSignal = 'HOLD';
    if (pEns >= 0.5 + CONVICTION_BAND && bullVotes >= MIN_CONSENSUS
        && this._passesRegimeFilter(row) && this._passesBuyFilter(row)) {
      masterSignal = 'BUY';
    } else if (pEns <= 0.5 - CONVICTION_BAND && bearVotes >= MIN_CONSENSUS
        && this._passesRegimeFilter(row) && this._passesSellFilter(row)) {
      masterSignal = 'SELL';
    }

    const confidence = Math.min(Math.abs(pEns - 0.5) * 2, 1);
    const entry = currentPrice;
    const atrVal = row.atr || (currentPrice * 0.001);
    const { sl, tp1, tp2 } = this._calcTradeParams(masterSignal, entry, atrVal);

    const digits = priceDigits(currentSymbol);
    const fmt = (v) => Number(v.toFixed(digits));

    let invalidation = 'Wait for setup';
    if (masterSignal !== 'HOLD') {
      const side = masterSignal === 'BUY' ? 'below' : 'above';
      invalidation = `Signal invalidated if price closes ${side} ${fmt(sl)}`;
    }

    // Which models actually agreed, and whether we're with the higher-TF trend.
    const votesMap = {
      ruleEngine: { signal: preds.ruleEngine.signal },
      lstm: { signal: preds.lstm.signal },
      randomForest: { signal: preds.randomForest.signal },
      logistic: { signal: preds.logistic.signal },
    };
    const modelsAligned = alignedModelNames(votesMap, masterSignal);
    const trendAligned = masterSignal === 'BUY'
      ? (row.trend_regime >= 0 || row.macro_trend === 1)
      : masterSignal === 'SELL'
        ? (row.trend_regime <= 0 || row.macro_trend === -1)
        : false;

    return {
      signal: masterSignal,
      confidence,
      ensemble_prob_up: pEns,
      models_aligned: modelsAligned,
      trend_filter: trendFilterText(trendAligned),
      timestamp: new Date().toISOString(),
      entry: fmt(entry),
      stop_loss: fmt(sl),
      take_profit_1: fmt(tp1),
      take_profit_2: fmt(tp2),
      risk_reward: RR,
      model_votes: {
        ruleEngine: { signal: preds.ruleEngine.signal, probability: preds.ruleEngine.probability },
        logistic: { signal: preds.logistic.signal, probability: preds.logistic.probability },
        randomForest: { signal: preds.randomForest.signal, probability: preds.randomForest.probability },
        lstm: { signal: preds.lstm.signal, probability: preds.lstm.probability },
      },
      top_reasons: this._generateReasons(masterSignal, preds.ruleEngine, row),
      invalidation,
    };
  }
}

// Export singleton
export const signalAggregator = new SignalAggregator();
