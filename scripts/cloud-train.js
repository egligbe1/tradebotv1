import dotenv from 'dotenv';
dotenv.config();

// Mock browser APIs for Zustand and TFJS imports
global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { FeatureEngine } from '../src/services/FeatureEngine.js';

import { Matrix } from 'ml-matrix';
import LogisticRegression from 'ml-logistic-regression';
import { RandomForestClassifier as RFClassifier } from 'ml-random-forest';

let tf;
try {
  tf = await import('@tensorflow/tfjs-node');
  console.log("🚀 Using @tensorflow/tfjs-node (Fast C++ Bindings)");
} catch (e) {
  tf = await import('@tensorflow/tfjs');
  console.log("⚠️ Using @tensorflow/tfjs (Slower JS Fallback)");
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const twelveDataKey = process.env.VITE_TWELVE_DATA_API_KEY || process.env.TWELVE_DATA_API_KEY;

if (!supabaseUrl || !supabaseKey || !twelveDataKey) {
  console.error("Missing required environment variables!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const AVAILABLE_SYMBOLS = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD', 'BTC/USD', 'SPX', 'AAPL'
];

// Logistic / RF Features
const FEATURES_22 = [
  'log_return', 'rsi_norm', 'hl_range', 'body_size', 'macd_hist', 
  'bb_pct_b', 'bb_width', 'atr_norm', 'stoch_k', 'stoch_d', 
  'cci', 'williams_r', 'vol_ratio', 'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
  'dist_to_support', 'dist_to_resistance', 'pivot_dist', 
  'trigger_engulfing', 'trigger_pinbar'
];

// LSTM Features
const FEATURES_20 = [
    'log_return', 'rsi_norm', 'hl_range', 'body_size', 'macd_hist', 
    'bb_pct_b', 'bb_width', 'atr_norm', 'stoch_k', 'stoch_d', 
    'vol_ratio', 'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
    'dist_to_support', 'dist_to_resistance', 'pivot_dist', 
    'trigger_engulfing', 'trigger_pinbar'
];
const LOOKBACK = 24;

// Utilities
async function updateStatus(workflowId, asset, message, percent, isTraining = true) {
  console.log(`[Status] ${asset || 'SYS'}: ${message}`);
  try {
    await supabase.from('training_status').upsert({
         workflow_id: workflowId,
         current_asset: asset,
         message: message,
         progress_percent: percent,
         is_training: isTraining,
         updated_at: new Date().toISOString()
    }, { onConflict: 'workflow_id' });
  } catch (e) {}
}

async function uploadWeights(symbol, modelName, weightsObj) {
    try {
        await supabase.from('model_sync').upsert({
            symbol: symbol,
            model_name: modelName,
            weights: weightsObj,
            updated_at: new Date().toISOString()
        }, { onConflict: 'symbol,model_name' });
    } catch (e) {
        console.error(`Failed isolating ${modelName} for ${symbol}:`, e.message);
    }
}

async function fetchHistoricalData(symbol) {
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1h&outputsize=3000&apikey=${twelveDataKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.values || data.status === 'error') throw new Error(data.message || 'TwelveData Error');
    // Map to floats and flip chronologically (TwelveData returns newest first)
    return data.values.map(d => ({
        datetime: d.datetime,
        open: parseFloat(d.open),
        high: parseFloat(d.high),
        low: parseFloat(d.low),
        close: parseFloat(d.close),
        volume: parseFloat(d.volume) || 0
    })).reverse();
}

// Model Training
function trainLogistic(featuresArr, symbol) {
    const X = [], y = [];
    for (const row of featuresArr) {
        let hasNull = false;
        const rowData = [];
        for (const feat of FEATURES_22) {
            if (row[feat] == null || isNaN(row[feat])) { hasNull = true; break; }
            rowData.push(row[feat]);
        }
        if (row.target_class == null) hasNull = true;
        if (!hasNull) { X.push(rowData); y.push(row.target_class); }
    }
    const splitIdx = Math.floor(X.length * 0.8);
    const xTrain = X.slice(0, splitIdx);
    const yTrain = y.slice(0, splitIdx);

    const model = new LogisticRegression({ numSteps: 1000, learningRate: 0.05 });
    model.train(new Matrix(xTrain), Matrix.columnVector(yTrain));
    return { weights: model.weights, theta: model.theta };
}

function trainRandomForest(featuresArr, symbol) {
    const X = [], y = [];
    for (const row of featuresArr) {
        let hasNull = false;
        const rowData = [];
        for (const feat of FEATURES_22) {
            if (row[feat] == null || isNaN(row[feat])) { hasNull = true; break; }
            rowData.push(row[feat]);
        }
        if (row.target_class == null) hasNull = true;
        if (!hasNull) { X.push(rowData); y.push(row.target_class); }
    }
    const splitIdx = Math.floor(X.length * 0.8);
    const xTrain = X.slice(0, splitIdx);
    const yTrain = y.slice(0, splitIdx);

    const options = { seed: 42, maxFeatures: 5, replacement: true, nEstimators: 50, treeOptions: { maxDepth: 6, minNumSamples: 10 }};
    const model = new RFClassifier(options);
    model.train(xTrain, yTrain);
    return model.toJSON();
}

async function trainLSTM(featuresArr, symbol) {
    const cleanRows = [];
    for (const row of featuresArr) {
        let hasNull = false;
        const rowData = [];
        for (const feat of FEATURES_20) {
            if (row[feat] == null || isNaN(row[feat])) { hasNull = true; break; }
            rowData.push(row[feat]);
        }
        if (row.target_class == null) hasNull = true;
        if (!hasNull) cleanRows.push({ x: rowData, y: row.target_class });
    }
    
    const X = [], y = [];
    if (cleanRows.length > LOOKBACK) {
        for (let i = 0; i < cleanRows.length - LOOKBACK; i++) {
            const seqX = [];
            for (let j = 0; j < LOOKBACK; j++) seqX.push(cleanRows[i + j].x);
            X.push(seqX);
            y.push(cleanRows[i + LOOKBACK - 1].y);
        }
    }

    const model = tf.sequential();
    model.add(tf.layers.lstm({ units: 64, returnSequences: true, inputShape: [LOOKBACK, FEATURES_20.length] }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    model.add(tf.layers.lstm({ units: 32, returnSequences: false }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

    model.compile({ optimizer: tf.train.adam(0.001), loss: 'binaryCrossentropy', metrics: ['accuracy'] });

    const splitIdx = Math.floor(X.length * 0.8);
    const xTrainT = tf.tensor3d(X.slice(0, splitIdx));
    const yTrainT = tf.tensor2d(y.slice(0, splitIdx), [splitIdx, 1]);
    const xValT = tf.tensor3d(X.slice(splitIdx));
    const yValT = tf.tensor2d(y.slice(splitIdx), [X.length - splitIdx, 1]);

    await model.fit(xTrainT, yTrainT, {
        epochs: 30,
        batchSize: 128,
        validationData: [xValT, yValT],
        shuffle: false
    });

    xTrainT.dispose(); yTrainT.dispose(); xValT.dispose(); yValT.dispose();

    // Export Cloud Weights
    let savedArtifacts = null;
    await model.save(tf.io.withSaveHandler(async (artifacts) => {
        savedArtifacts = artifacts;
        return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
    }));
    return savedArtifacts;
}

// --- Main Execution ---
async function runBatch() {
    const workflowId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
    await updateStatus(workflowId, 'SYS', 'Booting GitHub Cloud Training...', 0);

    for (let i = 0; i < AVAILABLE_SYMBOLS.length; i++) {
        const sym = AVAILABLE_SYMBOLS[i];
        const pctBase = (i / AVAILABLE_SYMBOLS.length) * 100;
        
        try {
            await updateStatus(workflowId, sym, `Fetching Twelve Data history.`, pctBase + 1);
            const candles = await fetchHistoricalData(sym);
            const features = FeatureEngine.extractFeatures(candles);

            await updateStatus(workflowId, sym, `Training Logistic Regression.`, pctBase + 3);
            const logWeights = trainLogistic(features, sym);
            await uploadWeights(sym, 'logistic', logWeights);

            await updateStatus(workflowId, sym, `Training Random Forest.`, pctBase + 5);
            const rfWeights = trainRandomForest(features, sym);
            await uploadWeights(sym, 'randomforest', rfWeights);

            await updateStatus(workflowId, sym, `Compiling LSTM Deep Neural Net.`, pctBase + 7);
            const lstmWeights = await trainLSTM(features, sym);
            await uploadWeights(sym, 'lstm', lstmWeights);

        } catch (e) {
            console.error(`Error processing ${sym}:`, e);
            await updateStatus(workflowId, sym, `Error: ${e.message}`, pctBase);
        }
    }

    await updateStatus(workflowId, 'COMPLETE', 'Batch training finished!', 100, false);
    console.log("Cloud training completely successfully.");
    process.exit(0);
}

runBatch();
