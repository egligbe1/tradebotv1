/**
 * server/core.js — shared training + inference for the headless bot.
 *
 * Reuses the EXACT verified core (feature contract, cores, calibration,
 * ensemble, walk-forward) so the 24/7 bot behaves identically to the browser
 * dashboard. No duplicated model logic.
 */

import { FeatureEngine } from '../src/services/FeatureEngine.js';
import { RuleEngine } from '../src/models/RuleEngine.js';
import { rowToVector, rowIsComplete, LOOKBACK, LABEL } from '../src/lib/featureContract.js';
import { buildDirectionalBinary, buildTabular } from '../src/models/core/dataset.js';
import { trainLogistic, predictLogisticProba } from '../src/models/core/logisticCore.js';
import { trainRandomForest, loadRandomForest, predictRfProba } from '../src/models/core/rfCore.js';
import { trainSequenceModel, predictSequenceProba } from '../src/models/core/lstmCore.js';
import { fitCalibrator, calibrate } from '../src/models/core/calibration.js';
import { brierSkill, fuseCalibrated } from '../src/models/core/ensemble.js';
import { walkForwardOOS } from '../src/models/core/walkforward.js';
import { getCostModel } from '../src/lib/assetConfig.js';
import { alignedModelNames, trendFilterText } from '../src/lib/signalMessage.js';

export const DEFAULT_WEIGHTS = { ruleEngine: 0.35, lstm: 0.35, randomForest: 0.20, logistic: 0.10 };
const CONVICTION_BAND = 0.06;
const MIN_CONSENSUS = 2;
const SL_ATR_MULT = 1.5;
const RR = 2;
const RR2 = 3;

const ruleEngine = new RuleEngine();

export async function fetchSeries(apiKey, symbol, interval, outputsize) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.values || data.status === 'error') throw new Error(data.message || `TwelveData error for ${symbol}`);
  return data.values.map((d) => ({
    datetime: d.datetime,
    open: parseFloat(d.open),
    high: parseFloat(d.high),
    low: parseFloat(d.low),
    close: parseFloat(d.close),
    volume: parseFloat(d.volume) || 0,
  })).reverse();
}

export async function buildFeatures(apiKey, symbol, oneHourSize = 3000) {
  const [c1h, c4h] = await Promise.all([
    fetchSeries(apiKey, symbol, '1h', oneHourSize),
    fetchSeries(apiKey, symbol, '4h', Math.min(2000, Math.floor(oneHourSize / 3))).catch(() => null),
  ]);
  const features = FeatureEngine.extractFeatures(c1h);
  if (c4h) FeatureEngine.enrichWithMacroTrend(features, c4h);
  return features;
}

/** Train all three ML models for one symbol; returns an in-memory bundle. */
export async function trainSymbol(tf, features, log = () => {}) {
  const bundle = { logistic: null, rf: null, lstm: null };

  // Logistic
  try {
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
      bundle.logistic = model;
      log(`logistic skill=${(model.skill ?? 0).toFixed(3)}`);
    }
  } catch (e) { log(`logistic failed: ${e.message}`); }

  // Random Forest
  try {
    const { X, y } = buildTabular(features);
    if (X.length >= 100) {
      const yUp = y.map((v) => (v === LABEL.UP ? 1 : 0));
      const wf = walkForwardOOS(X, y, yUp, {
        fit: (xt, yt) => loadRandomForest(trainRandomForest(xt, yt)),
        proba: (m, v) => predictRfProba(m, v)[2],
      });
      const deployEnd = Math.max(60, X.length - LABEL.HORIZON);
      const rf = loadRandomForest(trainRandomForest(X.slice(0, deployEnd), y.slice(0, deployEnd)));
      bundle.rf = { model: rf, calibrator: fitCalibrator(wf.scores, wf.y), skill: brierSkill(wf.scores, wf.y) };
      log(`RF skill=${(bundle.rf.skill ?? 0).toFixed(3)}`);
    }
  } catch (e) { log(`RF failed: ${e.message}`); }

  // LSTM
  try {
    const { model, scaler, metrics } = await trainSequenceModel(tf, features);
    bundle.lstm = {
      model, scaler,
      calibrator: fitCalibrator(metrics?.valProbsUp || [], metrics?.valYup || []),
      skill: brierSkill(metrics?.valProbsUp || [], metrics?.valYup || []),
    };
    log(`LSTM skill=${(bundle.lstm.skill ?? 0).toFixed(3)} valAcc=${((metrics?.valAccuracy ?? 0) * 100).toFixed(1)}%`);
  } catch (e) { log(`LSTM failed: ${e.message}`); }

  return bundle;
}

/** Evaluate the ensemble for the latest bar. Returns a signal object. */
export function evaluateSymbol(tf, symbol, features, bundle, weights = DEFAULT_WEIGHTS) {
  const row = features.at(-1);
  const vec = rowToVector(row);
  const preds = { ruleEngine: ruleEngine.predict(row) };

  if (bundle.logistic) {
    const raw = predictLogisticProba(bundle.logistic, vec);
    const pUp = calibrate(bundle.logistic.calibrator, raw);
    preds.logistic = { signal: pUp >= 0.58 ? 'BUY' : (pUp <= 0.42 ? 'SELL' : 'HOLD'), probability: pUp, skill: bundle.logistic.skill };
  }
  if (bundle.rf) {
    const [pDown, , pUpRaw] = predictRfProba(bundle.rf.model, vec);
    const pUp = calibrate(bundle.rf.calibrator, pUpRaw);
    let sig = 'HOLD';
    if (pUpRaw >= 0.42 && pUpRaw > pDown) sig = 'BUY';
    else if (pDown >= 0.42 && pDown > pUpRaw) sig = 'SELL';
    preds.randomForest = { signal: sig, probability: pUp, skill: bundle.rf.skill };
  }
  if (bundle.lstm) {
    const window = features.slice(-LOOKBACK);
    if (window.length === LOOKBACK && window.every(rowIsComplete)) {
      const [pDown, , pUpRaw] = predictSequenceProba(tf, bundle.lstm.model, bundle.lstm.scaler, window.map(rowToVector));
      const pUp = calibrate(bundle.lstm.calibrator, pUpRaw);
      let sig = 'HOLD';
      if (pUpRaw >= 0.45 && pUpRaw > pDown) sig = 'BUY';
      else if (pDown >= 0.45 && pDown > pUpRaw) sig = 'SELL';
      preds.lstm = { signal: sig, probability: pUp, skill: bundle.lstm.skill };
    }
  }

  const entries = Object.keys(preds).map((key) => ({
    key, p: preds[key].probability ?? 0.5, skill: preds[key].skill, userWeight: weights[key] ?? 0,
  }));
  const { pEns } = fuseCalibrated(entries);
  const bullVotes = Object.values(preds).filter((p) => p.signal === 'BUY').length;
  const bearVotes = Object.values(preds).filter((p) => p.signal === 'SELL').length;

  const regimeOk = (row.adx == null || row.adx >= 18) && (row.atr_norm == null || row.atr_norm >= 0.0003);
  const buyOk = row.ms_structure !== 'BEARISH' && !(row.trend_regime < -0.01) && !(row.macro_trend === -1 && row.trend_regime < 0);
  const sellOk = row.ms_structure !== 'BULLISH' && !(row.trend_regime > 0.01) && !(row.macro_trend === 1 && row.trend_regime > 0);

  let signal = 'HOLD';
  if (pEns >= 0.5 + CONVICTION_BAND && bullVotes >= MIN_CONSENSUS && regimeOk && buyOk) signal = 'BUY';
  else if (pEns <= 0.5 - CONVICTION_BAND && bearVotes >= MIN_CONSENSUS && regimeOk && sellOk) signal = 'SELL';

  const atr = row.atr || row.close * 0.001;
  const risk = SL_ATR_MULT * atr;
  const digits = getCostModel(symbol).digits;
  const rnd = (v) => Number(v.toFixed(digits));

  const modelsAligned = alignedModelNames(preds, signal);
  const trendAligned = signal === 'BUY'
    ? (row.trend_regime >= 0 || row.macro_trend === 1)
    : signal === 'SELL'
      ? (row.trend_regime <= 0 || row.macro_trend === -1)
      : false;

  return {
    symbol,
    signal,
    confidence: Math.min(Math.abs(pEns - 0.5) * 2, 1),
    ensembleProbUp: pEns,
    entry: rnd(row.close),
    sl: signal === 'BUY' ? rnd(row.close - risk) : rnd(row.close + risk),
    tp1: signal === 'BUY' ? rnd(row.close + RR * risk) : rnd(row.close - RR * risk),
    tp2: signal === 'BUY' ? rnd(row.close + RR2 * risk) : rnd(row.close - RR2 * risk),
    votes: { bull: bullVotes, bear: bearVotes },
    modelsAligned,
    trendFilter: trendFilterText(trendAligned),
    price: row.close,
  };
}

export async function sendTelegram(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch { /* best-effort */ }
}
