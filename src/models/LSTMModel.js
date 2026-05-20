import * as tf from '@tensorflow/tfjs';
import { useStore } from '@/store/useStore';
import { syncManager } from '@/services/SyncManager';

const FEATURES = [
  // Price action
  'log_return', 'hl_range', 'body_size',
  // Momentum oscillators
  'rsi_norm', 'macd_hist', 'stoch_k', 'stoch_d',
  // Volatility / bands
  'bb_pct_b', 'bb_width', 'atr_norm', 'squeeze_on',
  // Trend / EMA
  'trend_regime', 'trend_strength', 'ema9_gt_21', 'ema21_gt_50',
  // ADX / directional
  'adx_norm', 'di_alignment',
  // Volume
  'vol_ratio', 'obv_trend',
  // S/R & structure
  'dist_to_support', 'dist_to_resistance', 'pivot_dist',
  'ms_structure_num',
  // Patterns & divergence
  'trigger_engulfing', 'trigger_pinbar', 'rsi_bull_div', 'rsi_bear_div',
  // Session & macro
  'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos', 'macro_trend',
];
const LOOKBACK = 24; // H1 candles of context
const FEATURE_COUNT = FEATURES.length;

const getModelSavePath = (symbolOverride = null) => {
    const symbol = symbolOverride || useStore.getState().symbol || 'EUR/USD';
    const formattedSymbol = symbol.replace('/', '').toLowerCase();
    return `indexeddb://${formattedSymbol}-lstm-model`;
};

export class LSTMModel {
  constructor() {
    this.name = 'LSTMModel';
    this.model = null;
    this.isTrained = false;
  }

  async loadModelFromDb(cloudWeights = null, symbolOverride = null) {
    try {
      if (cloudWeights) {
        // Construct model from cloud artifacts
        const modelArtifacts = cloudWeights;
        const loadedModel = await tf.loadLayersModel(tf.io.fromMemory(modelArtifacts));
        this.model = loadedModel;
        this.model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'binaryCrossentropy',
            metrics: ['accuracy']
        });
        this.isTrained = true;
        // Also save to IndexedDB for faster local load next time
        await this.model.save(getModelSavePath(symbolOverride));
        console.log("[LSTMModel] Restored from Cloud artifacts.");
        return true;
      }

      const path = getModelSavePath(symbolOverride);
      const loadedModel = await tf.loadLayersModel(path);
      
      // Verify input shape matches current FEATURE_COUNT
      const expectedShape = [null, LOOKBACK, FEATURE_COUNT];
      const actualShape = loadedModel.layers[0].batchInputShape;
      
      // Comparison logic for shapes
      const isMatch = actualShape && 
                      actualShape[1] === expectedShape[1] && 
                      actualShape[2] === expectedShape[2];

      if (!isMatch) {
         console.warn(`[LSTMModel] Model shape mismatch. Expected ${JSON.stringify(expectedShape)}, Got ${JSON.stringify(actualShape)}. Discarding legacy model.`);
         this.model = null;
         this.isTrained = false;
         return false;
      }

      this.model = loadedModel;
      this.model.compile({
          optimizer: tf.train.adam(0.001),
          loss: 'binaryCrossentropy',
          metrics: ['accuracy']
      });
      this.isTrained = true;
      console.log("[LSTMModel] Loaded existing weights from IndexedDB.");
      return true;
    } catch (e) {
      console.log("[LSTMModel] No valid model found in DB or error loading, requires training.");
      this.isTrained = false;
      return false;
    }
  }

  buildModel() {
    this.model = tf.sequential();
    
    // LSTM(64) -> Dropout(0.2)
    this.model.add(tf.layers.lstm({
      units: 64,
      returnSequences: true,
      inputShape: [LOOKBACK, FEATURE_COUNT]
    }));
    this.model.add(tf.layers.dropout({ rate: 0.2 }));

    // LSTM(32) -> Dropout(0.2)
    this.model.add(tf.layers.lstm({
      units: 32,
      returnSequences: false
    }));
    this.model.add(tf.layers.dropout({ rate: 0.2 }));

    // Dense(16) -> Dense(1)
    this.model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    this.model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });
  }

  prepareSequences(featuresArr) {
    const X = [];
    const y = [];

    // Filter nulls and convert to matrix
    const cleanRows = [];
    for (let i = 0; i < featuresArr.length; i++) {
        let hasNull = false;
        const rowData = [];
        for (const feat of FEATURES) {
            let val = featuresArr[i][feat];
            if (val === null || val === undefined || Number.isNaN(val)) {
                hasNull = true; 
                break;
            }
            rowData.push(val);
        }
        if (featuresArr[i].target_class === null) hasNull = true;
        
        if (!hasNull) {
            cleanRows.push({
                x: rowData,
                y: featuresArr[i].target_class
            });
        }
    }

    // create overlapping sequences
    if (cleanRows.length > LOOKBACK) {
        for (let i = 0; i < cleanRows.length - LOOKBACK; i++) {
          const seqX = [];
          for (let j = 0; j < LOOKBACK; j++) {
             seqX.push(cleanRows[i + j].x);
          }
          X.push(seqX);
          y.push(cleanRows[i + LOOKBACK - 1].y);
        }
    }

    return { X, y };
  }

  async train(featuresArr, onProgressCallback = (epoch, logs) => {}, onStatsCallback = (stats) => {}, symbolOverride = null) {
    console.log("[LSTMModel] Starting training prep...");
    
    const {X, y} = this.prepareSequences(featuresArr);
    
    // Provide stats back to UI
    onStatsCallback({
        sequences: X.length,
        validRows: featuresArr.length
    });

    if (X.length < 100) {
       throw new Error(`Insufficient data: Created ${X.length} sequences. Need at least 100. Try fetching more history.`);
    }

    if (!this.model) {
      this.buildModel();
    }

    // Walk forward split - no shuffling time series!
    const splitIdx = Math.floor(X.length * 0.8);
    
    const xTrainT = tf.tensor3d(X.slice(0, splitIdx));
    const yTrainT = tf.tensor2d(y.slice(0, splitIdx), [splitIdx, 1]);

    const xValT = tf.tensor3d(X.slice(splitIdx));
    const yValT = tf.tensor2d(y.slice(splitIdx), [X.length - splitIdx, 1]);

    try {
        await this.model.fit(xTrainT, yTrainT, {
            epochs: 50,
            batchSize: 64,
            validationData: [xValT, yValT],
            shuffle: false, // critical for time series
            callbacks: {
              onEpochEnd: (epoch, logs) => {
                onProgressCallback(epoch, logs);
              }
            }
        });
    } finally {
        // Manually dispose of tensors to prevent memory leaks
        xTrainT.dispose();
        yTrainT.dispose();
        xValT.dispose();
        yValT.dispose();
    }

    console.log("[LSTMModel] Training complete.");
    this.isTrained = true;

    // Save model to DB
    const path = getModelSavePath(symbolOverride);
    await this.model.save(path);
    console.log(`[LSTMModel] Weights saved to DB at ${path}.`);

    // Auto-sync to cloud
    try {
        const symbol = symbolOverride || useStore.getState().symbol;
        // Capture model artifacts to a single object
        const saveResult = await this.model.save(tf.io.withSaveHandler(async (artifacts) => {
            return artifacts;
        }));
        await syncManager.uploadModel(symbol, 'lstm', saveResult);
    } catch (e) {
        console.error("[LSTMModel] Cloud sync failed:", e.message);
    }
  }

  predictSequence(recentFeatures) {
     if (!this.isTrained || !this.model || recentFeatures.length < LOOKBACK) {
         return { signal: 'HOLD', probability: 0.5 };
     }

     return tf.tidy(() => {
         const seqX = [];
         // grab the last `LOOKBACK` items
         const latestContext = recentFeatures.slice(-LOOKBACK);
         
         for (const row of latestContext) {
             const rowData = [];
             for (const feat of FEATURES) {
                 const v = row[feat];
                 rowData.push(v !== null && v !== undefined && !Number.isNaN(v) ? v : 0);
             }
             seqX.push(rowData);
         }

         const inputTensor = tf.tensor3d([seqX]);
         const predTensor  = this.model.predict(inputTensor);
         const probability = predTensor.dataSync()[0];

         // Tighter bands → fewer but higher-quality signals
         let signal = 'HOLD';
         if (probability > 0.65) signal = 'BUY';
         else if (probability < 0.35) signal = 'SELL';

         return { signal, probability };
     });
  }
}
