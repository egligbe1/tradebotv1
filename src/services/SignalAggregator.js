import { RuleEngine } from '@/models/RuleEngine';
import { LogisticModel } from '@/models/LogisticModel';
import { RandomForestModel } from '@/models/RandomForestModel';
import { LSTMModel } from '@/models/LSTMModel';
import { useStore } from '@/store/useStore';
import { syncManager } from '@/services/SyncManager';

export class SignalAggregator {
  constructor() {
    this.models = {
      ruleEngine: new RuleEngine(),
      logistic: new LogisticModel(),
      randomForest: new RandomForestModel(),
      lstm: new LSTMModel()
    };
    this.lastLstmSymbol = null;
  }

  async initializeLstm() {
     const symbol = useStore.getState().symbol || 'EUR/USD';
     const localSuccess = await this.models.lstm.loadModelFromDb();
     
     if (!localSuccess) {
       console.log(`[SignalAggregator] LSTM local empty for ${symbol}, checking cloud...`);
       const cloudWeights = await syncManager.downloadModel(symbol, 'lstm');
       if (cloudWeights) {
         await this.models.lstm.loadModelFromDb(cloudWeights);
       }
     }
     this.lastLstmSymbol = symbol;
  }

  async initializeOtherModels() {
    const symbol = useStore.getState().symbol || 'EUR/USD';
    const otherModels = ['logistic', 'randomForest'];
    
    for (const mKey of otherModels) {
      const model = this.models[mKey];
      const localSuccess = await model.loadFromLocal();
      
      if (!localSuccess) {
        console.log(`[SignalAggregator] ${mKey} local empty for ${symbol}, checking cloud...`);
        const cloudWeights = await syncManager.downloadModel(symbol, mKey === 'randomForest' ? 'randomforest' : mKey);
        if (cloudWeights) {
          await model.loadFromLocal(cloudWeights);
        }
      }
    }
  }

  async initializeAllModels() {
      await Promise.all([
          this.initializeLstm(),
          this.initializeOtherModels()
      ]);
  }

  /**
   * Generates a combined signal from all 4 models
   * @param {Array} features - Array of feature rows (chronological) 
   * @param {Object} currentPrice - Current price object (close, high, low, etc)
   * @param {Array} macroCandles - Optional 4h candles for macro filter
   */
  async generateSignal(features, currentPrice, macroCandles = null) {
    if (!features || features.length === 0) return null;

    // MTF Enrichment if macro data provided
    if (macroCandles) {
        const { FeatureEngine } = await import('./FeatureEngine.js');
        FeatureEngine.enrichWithMacroTrend(features, macroCandles);
    }
    
    // We get the weights/symbol dynamically from Zustand
    const weights = useStore.getState().modelWeights;
    const currentSymbol = useStore.getState().symbol;

    // Auto-initialize or reload models if the active symbol changed
    if (this.lastLstmSymbol !== currentSymbol) {
       await this.initializeAllModels();
       this.lastLstmSymbol = currentSymbol;
    }

    const latestRow = features[features.length - 1];

    // Get individual predictions (LSTM needs a sequence, others need just latest row)
    const rulePred = this.models.ruleEngine.predict(latestRow);
    const logisticPred = this.models.logistic.predict(latestRow);
    const rfPred = this.models.randomForest.predict(latestRow);
    const lstmPred = this.models.lstm.predictSequence(features);

    // Convert string signals to numeric values: BUY=1, HOLD=0, SELL=-1
    const getNumeric = (sig) => sig === 'BUY' ? 1 : (sig === 'SELL' ? -1 : 0);

    const scores = {
      ruleEngine: getNumeric(rulePred.signal) * weights.ruleEngine,
      logistic: getNumeric(logisticPred.signal) * weights.logistic,
      randomForest: getNumeric(rfPred.signal) * weights.randomForest,
      lstm: getNumeric(lstmPred.signal) * weights.lstm
    };

    const finalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    
    // Balanced Conviction: Strict enough for accuracy, relaxed enough for signals
    let masterSignal = 'HOLD';
    const CONVICTION_THRESHOLD = 0.40; // Sweet spot: needs 2+ models agreeing

    if (finalScore >= CONVICTION_THRESHOLD) {
        // Institutional Filter: Align with Structure + Macro Trend
        const isBearishStructure = latestRow.ms_structure === 'BEARISH';
        if (!isBearishStructure && latestRow.trend_regime >= -0.01) {
            masterSignal = 'BUY';
        } else {
            console.log(`[SignalAggregator] Filtered BUY: Fighting ${isBearishStructure ? 'Bearish Structure' : 'Strong Daily Trend'}.`);
        }
    } else if (finalScore <= -CONVICTION_THRESHOLD) {
        // Institutional Filter: Align with Structure + Macro Trend
        const isBullishStructure = latestRow.ms_structure === 'BULLISH';
        if (!isBullishStructure && latestRow.trend_regime <= 0.01) {
            masterSignal = 'SELL';
        } else {
            console.log(`[SignalAggregator] Filtered SELL: Fighting ${isBullishStructure ? 'Bullish Structure' : 'Strong Daily Trend'}.`);
        }
    }

    const confidence = Math.min(Math.abs(finalScore) / Math.max(...Object.values(weights), 1.0), 1.0);

    // Trade Parameters Calculation (ATR based)
    // entry = current price
    // Stop Loss = entry - 2.5 * ATR (if buy), entry + 2.5 * ATR (if sell)
    const entry = currentPrice;
    const currentAtr = latestRow.atr || 0.0010; // fallback 10 pips if null
    
    let sl = 0, tp1 = 0, tp2 = 0;
    
    if (masterSignal === 'BUY') {
        sl = entry - (2.5 * currentAtr);
        tp1 = entry + (2.0 * (entry - sl)); // RR 1:2
        tp2 = entry + (4.0 * (entry - sl)); // RR 1:4
    } else if (masterSignal === 'SELL') {
        sl = entry + (2.5 * currentAtr);
        tp1 = entry - (2.0 * (sl - entry)); // RR 1:2
        tp2 = entry - (4.0 * (sl - entry)); // RR 1:4
    }

    return {
      signal: masterSignal,
      confidence: confidence,
      timestamp: new Date().toISOString(),
      entry: Number(entry.toFixed(5)),
      stop_loss: Number(sl.toFixed(5)),
      take_profit_1: Number(tp1.toFixed(5)),
      take_profit_2: Number(tp2.toFixed(5)),
      risk_reward: 2.0, // base RR assumption based on TP1
      model_votes: {
         ruleEngine: { signal: rulePred.signal, probability: rulePred.probability },
         logistic: { signal: logisticPred.signal, probability: logisticPred.probability },
         randomForest: { signal: rfPred.signal, probability: rfPred.probability },
         lstm: { signal: lstmPred.signal, probability: lstmPred.probability }
      },
      top_reasons: this._generateReasons(masterSignal, rulePred, latestRow),
      invalidation: masterSignal !== 'HOLD' ? `Signal invalidated if price closes ${masterSignal === 'BUY' ? 'below' : 'above'} ${sl.toFixed(5)}` : 'Wait for setup'
    };
  }

  _generateReasons(masterSignal, rulePred, latestRow) {
     if (masterSignal === 'HOLD') return ['Market conditions neutral', 'Insufficient model consensus'];
     
     const reasons = [];
     if (masterSignal === 'BUY') {
         if (rulePred.reasonScore.buyScore >= 1) reasons.push('Technical indicators show bullish momentum');
         if (latestRow.trigger_engulfing === 1) reasons.push('Bullish Engulfing pattern identified');
         if (latestRow.trigger_pinbar === 1) reasons.push('Bullish Pin Bar / Rejection identified');
         if (latestRow.dist_to_support !== null && latestRow.dist_to_support < 0.001) reasons.push('Price is currently testing local Support');
         reasons.push('Model ensemble consensus favors upward trend');
     } else {
         if (rulePred.reasonScore.sellScore >= 1) reasons.push('Technical indicators show bearish momentum');
         if (latestRow.trigger_engulfing === -1) reasons.push('Bearish Engulfing pattern identified');
         if (latestRow.trigger_pinbar === -1) reasons.push('Bearish Pin Bar / Rejection identified');
         if (latestRow.dist_to_resistance !== null && latestRow.dist_to_resistance < 0.001) reasons.push('Price is currently testing local Resistance');
         reasons.push('Model ensemble consensus favors downward trend');
     }
     return reasons.slice(0, 3); // Max 3 reasons 
  }
}

// Export singleton
export const signalAggregator = new SignalAggregator();
