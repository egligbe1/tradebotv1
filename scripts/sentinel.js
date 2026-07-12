import dotenv from 'dotenv';
dotenv.config();

// Mock browser globals for ESM imports of pure modules that might touch them.
global.window = { location: { origin: '' } };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

import { createClient } from '@supabase/supabase-js';
import { FeatureEngine } from '../src/services/FeatureEngine.js';
import { RuleEngine } from '../src/models/RuleEngine.js';
import { rowToVector, rowIsComplete, LOOKBACK } from '../src/lib/featureContract.js';
import { predictLogisticProba } from '../src/models/core/logisticCore.js';
import { loadRandomForest, predictRfProba } from '../src/models/core/rfCore.js';
import { predictSequenceProba } from '../src/models/core/lstmCore.js';
import { calibrate } from '../src/models/core/calibration.js';
import { fuseCalibrated } from '../src/models/core/ensemble.js';
import { getCostModel } from '../src/lib/assetConfig.js';

let tf;
try {
  tf = await import('@tensorflow/tfjs-node');
} catch {
  tf = await import('@tensorflow/tfjs');
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const twelveDataKey = process.env.VITE_TWELVE_DATA_API_KEY || process.env.TWELVE_DATA_API_KEY;
const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.VITE_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

const AVAILABLE_SYMBOLS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD', 'BTC/USD', 'ETH/USD', 'SOL/USD'];

// Must mirror the browser store defaults & SignalAggregator thresholds so the
// autonomous bot and the dashboard produce the same calls.
const DEFAULT_WEIGHTS = { ruleEngine: 0.35, lstm: 0.35, randomForest: 0.20, logistic: 0.10 };
const CONVICTION_BAND = 0.06;
const MIN_CONSENSUS = 2;
const SL_ATR_MULT = 1.5;
const RR = 2;

if (!supabaseUrl || !supabaseKey || !twelveDataKey) {
  console.error('❌ Missing required environment variables!');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const ruleEngine = new RuleEngine();
const bandSignal = (pUp, up = 0.45, dn = 0.45) => (pUp >= up ? 'BUY' : (pUp <= (1 - dn) ? 'SELL' : 'HOLD'));

class CloudSignalAggregator {
  async loadModels(symbol) {
    const { data, error } = await supabase.from('model_sync').select('*').eq('symbol', symbol);
    if (error || !data || data.length === 0) return null;
    const models = {};
    data.forEach((w) => { models[w.model_name] = w.weights; });
    return models;
  }

  async evaluate(symbol, features) {
    const models = await this.loadModels(symbol);
    if (!models) { console.log(`[Sentinel] ⚠️ No models for ${symbol}. Skipping.`); return null; }

    const row = features.at(-1);
    const vec = rowToVector(row);
    const preds = {};

    // Rule engine (pure, always available)
    preds.ruleEngine = ruleEngine.predict(row);

    if (models.logistic && Array.isArray(models.logistic.weights)) {
      const raw = predictLogisticProba(models.logistic, vec);
      const pUp = calibrate(models.logistic.calibrator, raw);
      preds.logistic = { signal: bandSignal(pUp, 0.58, 0.58), probability: pUp, skill: models.logistic.skill };
    }
    if (models.randomforest) {
      try {
        const payload = models.randomforest;
        const json = payload.model ? payload.model : payload;
        const rf = loadRandomForest(json);
        const [pDown, , pUpRaw] = predictRfProba(rf, vec);
        const pUp = calibrate(payload.calibrator, pUpRaw);
        let sig = 'HOLD';
        if (pUpRaw >= 0.42 && pUpRaw > pDown) sig = 'BUY';
        else if (pDown >= 0.42 && pDown > pUpRaw) sig = 'SELL';
        preds.randomForest = { signal: sig, probability: pUp, skill: payload.skill };
      } catch (e) { console.warn(`[Sentinel] RF load failed for ${symbol}:`, e.message); }
    }
    if (models.lstm && models.lstm.artifacts) {
      try {
        const window = features.slice(-LOOKBACK);
        if (window.length === LOOKBACK && window.every(rowIsComplete)) {
          const lstm = await tf.loadLayersModel(tf.io.fromMemory(models.lstm.artifacts));
          const seqRows = window.map(rowToVector);
          const [pDown, , pUpRaw] = predictSequenceProba(tf, lstm, models.lstm.scaler, seqRows);
          lstm.dispose?.();
          const pUp = calibrate(models.lstm.calibrator, pUpRaw);
          let sig = 'HOLD';
          if (pUpRaw >= 0.45 && pUpRaw > pDown) sig = 'BUY';
          else if (pDown >= 0.45 && pDown > pUpRaw) sig = 'SELL';
          preds.lstm = { signal: sig, probability: pUp, skill: models.lstm.skill };
        }
      } catch (e) { console.warn(`[Sentinel] LSTM load failed for ${symbol}:`, e.message); }
    }

    // Skill-weighted calibrated fusion (mirrors SignalAggregator._fuse).
    const entries = Object.keys(preds).map((key) => ({
      key, p: preds[key].probability ?? 0.5, skill: preds[key].skill, userWeight: DEFAULT_WEIGHTS[key] ?? 0,
    }));
    const { pEns } = fuseCalibrated(entries);
    const bullVotes = Object.values(preds).filter((p) => p.signal === 'BUY').length;
    const bearVotes = Object.values(preds).filter((p) => p.signal === 'SELL').length;

    const regimeOk = (row.adx === null || row.adx === undefined || row.adx >= 18)
      && (row.atr_norm === null || row.atr_norm === undefined || row.atr_norm >= 0.0003);
    const buyOk = row.ms_structure !== 'BEARISH' && !(row.trend_regime < -0.01) && !(row.macro_trend === -1 && row.trend_regime < 0);
    const sellOk = row.ms_structure !== 'BULLISH' && !(row.trend_regime > 0.01) && !(row.macro_trend === 1 && row.trend_regime > 0);

    let signal = 'HOLD';
    if (pEns >= 0.5 + CONVICTION_BAND && bullVotes >= MIN_CONSENSUS && regimeOk && buyOk) signal = 'BUY';
    else if (pEns <= 0.5 - CONVICTION_BAND && bearVotes >= MIN_CONSENSUS && regimeOk && sellOk) signal = 'SELL';

    const atr = row.atr || row.close * 0.001;
    const risk = SL_ATR_MULT * atr;
    return {
      signal,
      confidence: Math.min(Math.abs(pEns - 0.5) * 2, 1),
      entry: row.close,
      sl: signal === 'BUY' ? row.close - risk : row.close + risk,
      tp: signal === 'BUY' ? row.close + RR * risk : row.close - RR * risk,
    };
  }
}

async function logTrade(symbol, s) {
  try {
    await supabase.from('trades').insert({
      symbol, side: s.signal, entry_price: s.entry, sl_price: s.sl, tp_price: s.tp, status: 'OPEN',
    });
    console.log(`[Sentinel] 📝 Trade logged for ${symbol}`);
  } catch (e) { console.error('[Sentinel] ❌ Log failed:', e.message); }
}

async function manageOpenTrades(symbol, currentPrice) {
  try {
    const { data: openTrades } = await supabase.from('trades').select('*').eq('symbol', symbol).eq('status', 'OPEN');
    if (!openTrades) return;
    for (const trade of openTrades) {
      const risk = Math.abs(trade.entry_price - trade.sl_price);
      const pnl = trade.side === 'BUY' ? (currentPrice - trade.entry_price) : (trade.entry_price - currentPrice);
      if (pnl >= risk && trade.sl_price !== trade.entry_price) {
        await supabase.from('trades').update({ sl_price: trade.entry_price }).eq('id', trade.id);
      }
      let exit = false; let finalPnl = 0;
      if (trade.side === 'BUY') {
        if (currentPrice <= trade.sl_price) { exit = true; finalPnl = ((trade.sl_price - trade.entry_price) / trade.entry_price) * 100; }
        else if (currentPrice >= trade.tp_price) { exit = true; finalPnl = ((trade.tp_price - trade.entry_price) / trade.entry_price) * 100; }
      } else {
        if (currentPrice >= trade.sl_price) { exit = true; finalPnl = ((trade.entry_price - trade.sl_price) / trade.entry_price) * 100; }
        else if (currentPrice <= trade.tp_price) { exit = true; finalPnl = ((trade.entry_price - trade.tp_price) / trade.entry_price) * 100; }
      }
      if (exit) {
        // Deduct realistic round-trip cost from the recorded P&L.
        const netPnl = finalPnl - getCostModel(symbol).roundTrip * 100;
        await supabase.from('trades').update({ status: 'CLOSED', pnl: netPnl, closed_at: new Date().toISOString() }).eq('id', trade.id);
      }
    }
  } catch { /* ignore */ }
}

async function sendTelegram(symbol, s) {
  if (!botToken || !chatId || s.signal === 'HOLD') return;
  const action = s.signal === 'BUY' ? '🟢 BUY' : '🔴 SELL';
  const digits = getCostModel(symbol).digits;
  const message = `<b>🚨 CLOUD SENTINEL ALERT 🚨</b>
<b>Asset:</b> ${symbol}
<b>Action:</b> ${action}
<b>Conviction:</b> ${(s.confidence * 100).toFixed(1)}%

<b>Entry:</b> ${s.entry.toFixed(digits)}
<b>SL/TP:</b> ${s.sl.toFixed(digits)} / ${s.tp.toFixed(digits)}`;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch { /* ignore */ }
}

async function fetchSeries(symbol, interval, outputsize) {
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${twelveDataKey}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.values) throw new Error(d.message || 'TwelveData error');
  return d.values.map((v) => ({
    datetime: v.datetime,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: parseFloat(v.volume) || 0,
  })).reverse();
}

async function runSentinel() {
  console.log('⏱️ [Sentinel] Starting autonomous scan…');
  const aggregator = new CloudSignalAggregator();

  for (const sym of AVAILABLE_SYMBOLS) {
    try {
      const [c1h, c4h] = await Promise.all([
        fetchSeries(sym, '1h', 800),
        fetchSeries(sym, '4h', 400).catch(() => null),
      ]);
      const features = FeatureEngine.extractFeatures(c1h);
      if (c4h) FeatureEngine.enrichWithMacroTrend(features, c4h);
      const latest = features.at(-1);

      await manageOpenTrades(sym, latest.close);

      const result = await aggregator.evaluate(sym, features);
      if (result && result.signal !== 'HOLD' && result.confidence > 0.12) {
        await logTrade(sym, result);
        await sendTelegram(sym, result);
      }
    } catch (e) { console.error(`[Sentinel] ${sym} Error:`, e.message); }
  }
  process.exit(0);
}

runSentinel();
