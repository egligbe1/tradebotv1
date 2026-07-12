import dotenv from 'dotenv';
dotenv.config();

// Mock browser APIs for any transitively-imported modules that expect them.
global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

import { createClient } from '@supabase/supabase-js';
import { FeatureEngine } from '../src/services/FeatureEngine.js';
import { buildDirectionalBinary, buildTabular } from '../src/models/core/dataset.js';
import { trainLogistic, predictLogisticProba } from '../src/models/core/logisticCore.js';
import { trainRandomForest, loadRandomForest, predictRfProba } from '../src/models/core/rfCore.js';
import { trainSequenceModel } from '../src/models/core/lstmCore.js';
import { fitCalibrator } from '../src/models/core/calibration.js';
import { brierSkill } from '../src/models/core/ensemble.js';
import { walkForwardOOS } from '../src/models/core/walkforward.js';
import { FEATURE_COUNT, LOOKBACK, LABEL } from '../src/lib/featureContract.js';

let tf;
try {
  tf = await import('@tensorflow/tfjs-node');
  console.log('🚀 Using @tensorflow/tfjs-node (Fast C++ Bindings)');
} catch {
  tf = await import('@tensorflow/tfjs');
  console.log('⚠️ Using @tensorflow/tfjs (Slower JS Fallback)');
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const twelveDataKey = process.env.VITE_TWELVE_DATA_API_KEY || process.env.TWELVE_DATA_API_KEY;

if (!supabaseUrl || !supabaseKey || !twelveDataKey) {
  console.error('Missing required environment variables!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const AVAILABLE_SYMBOLS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD', 'BTC/USD', 'ETH/USD', 'SOL/USD'];

async function updateStatus(workflowId, asset, message, percent, isTraining = true) {
  console.log(`[Status] ${asset || 'SYS'}: ${message}`);
  try {
    await supabase.from('training_status').upsert({
      workflow_id: workflowId,
      current_asset: asset,
      message,
      progress_percent: percent,
      is_training: isTraining,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workflow_id' });
  } catch { /* status table may not exist */ }
}

async function uploadWeights(symbol, modelName, weightsObj) {
  try {
    await supabase.from('model_sync').upsert({
      symbol,
      model_name: modelName,
      weights: weightsObj,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'symbol,model_name' });
  } catch (e) {
    console.error(`Failed uploading ${modelName} for ${symbol}:`, e.message);
  }
}

async function fetchSeries(symbol, interval, outputsize) {
  // timezone=UTC keeps session/hour features consistent with the browser.
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${twelveDataKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.values || data.status === 'error') throw new Error(data.message || 'TwelveData Error');
  return data.values.map((d) => ({
    datetime: d.datetime,
    open: parseFloat(d.open),
    high: parseFloat(d.high),
    low: parseFloat(d.low),
    close: parseFloat(d.close),
    volume: parseFloat(d.volume) || 0,
  })).reverse(); // TwelveData returns newest-first
}

async function buildFeatures(symbol) {
  const [c1h, c4h] = await Promise.all([
    fetchSeries(symbol, '1h', 5000),
    fetchSeries(symbol, '4h', 2000).catch(() => null),
  ]);
  const features = FeatureEngine.extractFeatures(c1h);
  if (c4h) FeatureEngine.enrichWithMacroTrend(features, c4h);
  return features;
}

async function runBatch() {
  const workflowId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  await updateStatus(workflowId, 'SYS', 'Booting cloud training…', 0);

  for (let i = 0; i < AVAILABLE_SYMBOLS.length; i++) {
    const sym = AVAILABLE_SYMBOLS[i];
    const pctBase = (i / AVAILABLE_SYMBOLS.length) * 100;

    try {
      await updateStatus(workflowId, sym, 'Fetching Twelve Data history.', pctBase + 1);
      const features = await buildFeatures(sym);

      // Logistic (directional UP vs DOWN) — train early slice, calibrate on later.
      await updateStatus(workflowId, sym, 'Training Logistic Regression.', pctBase + 3);
      {
        const { X, y } = buildDirectionalBinary(features);
        if (X.length >= 100) {
          const wf = walkForwardOOS(X, y, y, {
            fit: (xt, yt) => trainLogistic(xt, yt),
            proba: (m, v) => predictLogisticProba(m, v),
          });
          const deployEnd = Math.max(60, X.length - LABEL.HORIZON);
          const model = trainLogistic(X.slice(0, deployEnd), y.slice(0, deployEnd));
          model.calibrator = fitCalibrator(wf.scores, wf.y);
          model.skill = brierSkill(wf.scores, wf.y);
          await uploadWeights(sym, 'logistic', model);
          console.log(`   └─ ${sym} logistic OOS skill=${(model.skill ?? 0).toFixed(3)}`);
        } else {
          console.warn(`   └─ ${sym}: only ${X.length} logistic rows, skipping.`);
        }
      }

      // Random Forest (3-class directional) + walk-forward calibration.
      await updateStatus(workflowId, sym, 'Training Random Forest.', pctBase + 5);
      {
        const { X, y } = buildTabular(features);
        if (X.length >= 100) {
          const yUp = y.map((v) => (v === LABEL.UP ? 1 : 0));
          const wf = walkForwardOOS(X, y, yUp, {
            fit: (xt, yt) => loadRandomForest(trainRandomForest(xt, yt)),
            proba: (m, v) => predictRfProba(m, v)[2],
          });
          const deployEnd = Math.max(60, X.length - LABEL.HORIZON);
          const json = trainRandomForest(X.slice(0, deployEnd), y.slice(0, deployEnd));
          const calibrator = fitCalibrator(wf.scores, wf.y);
          const skill = brierSkill(wf.scores, wf.y);
          await uploadWeights(sym, 'randomforest', { model: json, calibrator, skill });
          console.log(`   └─ ${sym} RF OOS skill=${(skill ?? 0).toFixed(3)}`);
        } else {
          console.warn(`   └─ ${sym}: only ${X.length} RF rows, skipping.`);
        }
      }

      // LSTM (3-class softmax) with scaler + early stopping + class weights + calibration.
      await updateStatus(workflowId, sym, 'Compiling LSTM Deep Neural Net.', pctBase + 7);
      {
        const { model, scaler, metrics } = await trainSequenceModel(tf, features, {
          onEpoch: (e, logs) => console.log(`   └─ ${sym} LSTM epoch ${e + 1} loss=${(logs.loss || 0).toFixed(4)} val=${(logs.val_loss || 0).toFixed(4)}`),
        });
        const calibrator = fitCalibrator(metrics?.valProbsUp || [], metrics?.valYup || []);
        const skill = brierSkill(metrics?.valProbsUp || [], metrics?.valYup || []);
        let artifacts = null;
        await model.save(tf.io.withSaveHandler(async (a) => { artifacts = a; return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }; }));
        await uploadWeights(sym, 'lstm', { artifacts, scaler, calibrator, skill, featureCount: FEATURE_COUNT, lookback: LOOKBACK });
        console.log(`   └─ ${sym} LSTM skill=${(skill ?? 0).toFixed(3)} valAcc=${((metrics?.valAccuracy ?? 0) * 100).toFixed(1)}%`);
        model.dispose?.();
      }
    } catch (e) {
      console.error(`Error processing ${sym}:`, e);
      await updateStatus(workflowId, sym, `Error: ${e.message}`, pctBase);
    }
  }

  await updateStatus(workflowId, 'COMPLETE', 'Batch training finished!', 100, false);
  console.log('Cloud training completed successfully.');
  process.exit(0);
}

runBatch();
