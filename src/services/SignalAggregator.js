import { RuleEngine } from '@/models/RuleEngine';
import { LogisticModel } from '@/models/LogisticModel';
import { RandomForestModel } from '@/models/RandomForestModel';
import { LSTMModel } from '@/models/LSTMModel';
import { useStore } from '@/store/useStore';
import { syncManager } from '@/services/SyncManager';

const CONVICTION_THRESHOLD = 0.5;

function sigNum(sig) {
  if (sig === 'BUY')  return 1;
  if (sig === 'SELL') return -1;
  return 0;
}

export class SignalAggregator {
  constructor() {
    this.models = {
      ruleEngine:   new RuleEngine(),
      logistic:     new LogisticModel(),
      randomForest: new RandomForestModel(),
      lstm:         new LSTMModel(),
    };
    this.lastLstmSymbol = null;
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  async initializeLstm() {
    const symbol = useStore.getState().symbol || 'EUR/USD';
    const ok = await this.models.lstm.loadModelFromDb();
    if (!ok) {
      console.log(`[SignalAggregator] LSTM local empty for ${symbol}, checking cloud...`);
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
        console.log(`[SignalAggregator] ${mKey} local empty for ${symbol}, checking cloud...`);
        const cloudKey = mKey === 'randomForest' ? 'randomforest' : mKey;
        const weights = await syncManager.downloadModel(symbol, cloudKey);
        if (weights) await model.loadFromLocal(weights);
      }
    }
  }

  async initializeAllModels() {
    await Promise.all([this.initializeLstm(), this.initializeOtherModels()]);
  }

  // ── Signal filters ────────────────────────────────────────────────────────

  _passesBuyFilter(latestRow) {
    const isBearishStructure = latestRow.ms_structure === 'BEARISH';
    const isFightingTrend    = latestRow.trend_regime < -0.01;
    if (isBearishStructure) {
      console.log('[SignalAggregator] Filtered BUY: Fighting Bearish Structure.');
      return false;
    }
    if (isFightingTrend) {
      console.log('[SignalAggregator] Filtered BUY: Fighting Strong Daily Trend.');
      return false;
    }
    return true;
  }

  _passesSellFilter(latestRow) {
    const isBullishStructure = latestRow.ms_structure === 'BULLISH';
    const isFightingTrend    = latestRow.trend_regime > 0.01;
    if (isBullishStructure) {
      console.log('[SignalAggregator] Filtered SELL: Fighting Bullish Structure.');
      return false;
    }
    if (isFightingTrend) {
      console.log('[SignalAggregator] Filtered SELL: Fighting Strong Daily Trend.');
      return false;
    }
    return true;
  }

  _passesAdxFilter(latestRow) {
    if (latestRow.adx !== null && latestRow.adx < 18) {
      console.log(`[SignalAggregator] Filtered signal: ADX ${latestRow.adx.toFixed(1)} indicates ranging market.`);
      return false;
    }
    return true;
  }

  _resolveDirection(finalScore, bullVotes, bearVotes, latestRow) {
    if (finalScore >= CONVICTION_THRESHOLD && bullVotes >= 2 && this._passesBuyFilter(latestRow)) {
      return 'BUY';
    }
    if (finalScore <= -CONVICTION_THRESHOLD && bearVotes >= 2 && this._passesSellFilter(latestRow)) {
      return 'SELL';
    }
    return 'HOLD';
  }

  // ── Trade parameters ──────────────────────────────────────────────────────

  _calcTradeParams(signal, entry, atr) {
    if (signal === 'BUY') {
      const sl  = entry - 2.5 * atr;
      const risk = entry - sl;
      return { sl, tp1: entry + 2 * risk, tp2: entry + 4 * risk };
    }
    if (signal === 'SELL') {
      const sl  = entry + 2.5 * atr;
      const risk = sl - entry;
      return { sl, tp1: entry - 2 * risk, tp2: entry - 4 * risk };
    }
    return { sl: 0, tp1: 0, tp2: 0 };
  }

  // ── Reason generation ─────────────────────────────────────────────────────

  _buyReasons(rulePred, latestRow) {
    const r = [];
    if (rulePred.reasonScore.buyScore >= 1) r.push('Technical indicators show bullish momentum');
    if (latestRow.rsi_bull_div === 1)        r.push('Bullish RSI divergence detected');
    if (latestRow.trigger_engulfing === 1)   r.push('Bullish Engulfing pattern identified');
    if (latestRow.trigger_pinbar    === 1)   r.push('Bullish Pin Bar / Rejection identified');
    if (latestRow.trigger_star      === 1)   r.push('Morning Star reversal pattern identified');
    if (latestRow.dist_to_support !== null && latestRow.dist_to_support < 0.001)
      r.push('Price is currently testing local Support');
    if (latestRow.adx !== null && latestRow.adx > 25) r.push('Strong trend confirmed by ADX');
    r.push('Model ensemble consensus favors upward trend');
    return r;
  }

  _sellReasons(rulePred, latestRow) {
    const r = [];
    if (rulePred.reasonScore.sellScore >= 1) r.push('Technical indicators show bearish momentum');
    if (latestRow.rsi_bear_div === 1)         r.push('Bearish RSI divergence detected');
    if (latestRow.trigger_engulfing === -1)   r.push('Bearish Engulfing pattern identified');
    if (latestRow.trigger_pinbar    === -1)   r.push('Bearish Pin Bar / Rejection identified');
    if (latestRow.trigger_star      === -1)   r.push('Evening Star reversal pattern identified');
    if (latestRow.dist_to_resistance !== null && latestRow.dist_to_resistance < 0.001)
      r.push('Price is currently testing local Resistance');
    if (latestRow.adx !== null && latestRow.adx > 25) r.push('Strong trend confirmed by ADX');
    r.push('Model ensemble consensus favors downward trend');
    return r;
  }

  _generateReasons(masterSignal, rulePred, latestRow) {
    if (masterSignal === 'HOLD') return ['Market conditions neutral', 'Insufficient model consensus'];
    const reasons = masterSignal === 'BUY'
      ? this._buyReasons(rulePred, latestRow)
      : this._sellReasons(rulePred, latestRow);
    return reasons.slice(0, 3);
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  async generateSignal(features, currentPrice, macroCandles = null) {
    if (!features || features.length === 0) return null;

    if (macroCandles) {
      const { FeatureEngine } = await import('./FeatureEngine.js');
      FeatureEngine.enrichWithMacroTrend(features, macroCandles);
    }

    const weights       = useStore.getState().modelWeights;
    const currentSymbol = useStore.getState().symbol;

    if (this.lastLstmSymbol !== currentSymbol) {
      await this.initializeAllModels();
      this.lastLstmSymbol = currentSymbol;
    }

    const latestRow   = features.at(-1);
    const rulePred    = this.models.ruleEngine.predict(latestRow);
    const logisticPred = this.models.logistic.predict(latestRow);
    const rfPred      = this.models.randomForest.predict(latestRow);
    const lstmPred    = this.models.lstm.predictSequence(features);

    const scores = {
      ruleEngine:   sigNum(rulePred.signal)    * weights.ruleEngine,
      logistic:     sigNum(logisticPred.signal) * weights.logistic,
      randomForest: sigNum(rfPred.signal)       * weights.randomForest,
      lstm:         sigNum(lstmPred.signal)     * weights.lstm,
    };

    const finalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const allVotes   = [rulePred.signal, logisticPred.signal, rfPred.signal, lstmPred.signal];
    const bullVotes  = allVotes.filter(v => v === 'BUY').length;
    const bearVotes  = allVotes.filter(v => v === 'SELL').length;

    let masterSignal = this._resolveDirection(finalScore, bullVotes, bearVotes, latestRow);
    if (masterSignal !== 'HOLD' && !this._passesAdxFilter(latestRow)) masterSignal = 'HOLD';

    const maxWeight  = Math.max(...Object.values(weights), 1);
    const confidence = Math.min(Math.abs(finalScore) / maxWeight, 1);

    const entry      = currentPrice;
    const currentAtr = latestRow.atr || 0.001;
    const { sl, tp1, tp2 } = this._calcTradeParams(masterSignal, entry, currentAtr);

    const fmt5 = v => Number(v.toFixed(5));

    let invalidation = 'Wait for setup';
    if (masterSignal !== 'HOLD') {
      const side = masterSignal === 'BUY' ? 'below' : 'above';
      invalidation = `Signal invalidated if price closes ${side} ${sl.toFixed(5)}`;
    }

    return {
      signal:        masterSignal,
      confidence,
      timestamp:     new Date().toISOString(),
      entry:         fmt5(entry),
      stop_loss:     fmt5(sl),
      take_profit_1: fmt5(tp1),
      take_profit_2: fmt5(tp2),
      risk_reward:   2,
      model_votes: {
        ruleEngine:   { signal: rulePred.signal,     probability: rulePred.probability },
        logistic:     { signal: logisticPred.signal,  probability: logisticPred.probability },
        randomForest: { signal: rfPred.signal,        probability: rfPred.probability },
        lstm:         { signal: lstmPred.signal,      probability: lstmPred.probability },
      },
      top_reasons: this._generateReasons(masterSignal, rulePred, latestRow),
      invalidation,
    };
  }
}

// Export singleton
export const signalAggregator = new SignalAggregator();
