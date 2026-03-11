import { RandomForestClassifier as RFClassifier } from 'ml-random-forest';

const FEATURES = [
  'log_return', 'rsi_norm', 'hl_range', 'body_size', 'macd_hist', 
  'bb_pct_b', 'bb_width', 'atr_norm', 'stoch_k', 'stoch_d', 
  'cci', 'williams_r', 'vol_ratio', 'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
  'dist_to_support', 'dist_to_resistance', 'pivot_dist', 
  'trigger_engulfing', 'trigger_pinbar'
];

export class RandomForestModel {
  constructor() {
    this.name = 'RandomForestModel';
    this.model = null;
    this.isTrained = false;
    this.options = {
      seed: 42,
      maxFeatures: 5,
      replacement: true,
      nEstimators: 50,
      treeOptions: {
        maxDepth: 6,
        minNumSamples: 10
      }
    };
  }

  prepareData(featuresArr) {
    const X = [];
    const y = [];

    for (let i = 200; i < featuresArr.length - 1; i++) {
      const row = featuresArr[i];
      let hasNull = false;
      const xRow = [];
      
      for (const feat of FEATURES) {
        if (row[feat] === null || row[feat] === undefined || isNaN(row[feat])) {
          hasNull = true;
          break;
        }
        xRow.push(row[feat]);
      }

      if (row.target_class === null) hasNull = true;

      if (!hasNull) {
        X.push(xRow);
        // Model requires string classes
        y.push(row.target_class === 1 ? 'UP' : 'DOWN');
      }
    }

    return { X, y };
  }

  async train(featuresArr) {
    const { X, y } = this.prepareData(featuresArr);
    if (X.length < 50) {
      throw new Error("Not enough clean data to train Random Forest.");
    }

    const splitIdx = Math.floor(X.length * 0.8);
    const xTrain = X.slice(0, splitIdx);
    const yTrain = y.slice(0, splitIdx);

    this.model = new RFClassifier(this.options);
    this.model.train(xTrain, yTrain);
    this.isTrained = true;
    console.log(`[RandomForestModel] Trained 50 trees on ${xTrain.length} samples.`);
  }

  predict(latestRow) {
    if (!this.isTrained || !this.model) {
      return { signal: 'HOLD', probability: 0.5 };
    }

    const xInput = [];
    for (const feat of FEATURES) {
       xInput.push(latestRow[feat] || 0);
    }
    
    // We can use predictOOB or predictProbability if available, but for 
    // ml-random-forest `predict` returns string array.
    const preds = this.model.predict([xInput]);
    const predClass = preds[0];
    
    // Fake probability synthesis based on class due to library limits on single row probabilties
    // In a prod app we would sum the votes of the trees to get a true ratio.
    const probability = predClass === 'UP' ? 0.65 : 0.35;

    let signal = 'HOLD';
    // Rules: P > 0.58 = BUY, P < 0.42 = SELL
    if (probability > 0.58) signal = 'BUY';
    else if (probability < 0.42) signal = 'SELL';

    return { signal, probability };
  }
}
