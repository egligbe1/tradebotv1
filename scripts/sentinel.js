import dotenv from 'dotenv';
dotenv.config();

// Mock browser globals for ESM imports of services that might expect them
global.window = { location: { origin: '' } };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

import { createClient } from '@supabase/supabase-js';
import { FeatureEngine } from '../src/services/FeatureEngine.js';

// Models
import { Matrix } from 'ml-matrix';
import LogisticRegression from 'ml-logistic-regression';
import { RandomForestClassifier as RFClassifier } from 'ml-random-forest';

let tf;
try {
  tf = await import('@tensorflow/tfjs-node');
} catch (e) {
  tf = await import('@tensorflow/tfjs');
}

// Variables
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const twelveDataKey = process.env.VITE_TWELVE_DATA_API_KEY || process.env.TWELVE_DATA_API_KEY;
const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.VITE_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

const AVAILABLE_SYMBOLS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD', 'BTC/USD', 'ETH/USD', 'SOL/USD'];

const FEATURES_22 = [
  'log_return', 'rsi_norm', 'hl_range', 'body_size', 'macd_hist', 
  'bb_pct_b', 'bb_width', 'atr_norm', 'stoch_k', 'stoch_d', 
  'cci', 'williams_r', 'vol_ratio', 'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
  'dist_to_support', 'dist_to_resistance', 'pivot_dist', 
  'trigger_engulfing', 'trigger_pinbar', 'trend_regime', 'trend_strength'
];

if (!supabaseUrl || !supabaseKey || !twelveDataKey) {
  console.error("❌ Missing required environment variables!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Mocks the SignalAggregator logic for Node environment
 */
class CloudSignalAggregator {
  async evaluate(symbol, latestFeature) {
    const { data: weightsData, error } = await supabase
      .from('model_sync')
      .select('*')
      .eq('symbol', symbol);

    if (error || !weightsData || weightsData.length === 0) {
      console.log(`[Sentinel] ⚠️ No models found for ${symbol}. Skipping.`);
      return null;
    }

    const models = {};
    weightsData.forEach(w => { models[w.model_name] = w.weights; });

    let probs = [];
    if (models.logistic) {
      const { theta } = models.logistic;
      let z = theta[0]; 
      for (let i = 0; i < FEATURES_22.length; i++) {
        z += theta[i+1] * (latestFeature[FEATURES_22[i]] || 0);
      }
      probs.push(1 / (1 + Math.exp(-z)));
    }

    if (models.randomforest) {
      const rf = RFClassifier.fromJSON(models.randomforest);
      const rowData = FEATURES_22.map(f => latestFeature[f] || 0);
      probs.push(rf.predictProbability([rowData], 1)[0]);
    }

    const meanProb = probs.reduce((a, b) => a + b, 0) / probs.length;
    const conviction = Math.abs(meanProb - 0.5) * 2;
    const signal = meanProb > 0.55 ? 'BUY' : (meanProb < 0.45 ? 'SELL' : 'HOLD');
    
    const atr = latestFeature.atr || 0.0012;
    return { 
        signal, 
        confidence: conviction, 
        entry: latestFeature.close,
        sl: signal === 'BUY' ? latestFeature.close - (atr * 2.5) : latestFeature.close + (atr * 2.5),
        tp: signal === 'BUY' ? latestFeature.close + (atr * 4.0) : latestFeature.close - (atr * 4.0)
    };
  }
}

async function logTrade(symbol, signalData) {
    try {
        await supabase.from('trades').insert({
            symbol,
            side: signalData.signal,
            entry_price: signalData.entry,
            sl_price: signalData.sl,
            tp_price: signalData.tp,
            status: 'OPEN'
        });
        console.log(`[Sentinel] 📝 Trade logged for ${symbol}`);
    } catch (e) {
        console.error(`[Sentinel] ❌ Log failed:`, e.message);
    }
}

async function manageOpenTrades(symbol, currentPrice) {
    try {
        const { data: openTrades } = await supabase.from('trades').select('*').eq('symbol', symbol).eq('status', 'OPEN');
        if (!openTrades) return;

        for (const trade of openTrades) {
            const risk = Math.abs(trade.entry_price - trade.sl_price);
            const pnl = trade.side === 'BUY' ? (currentPrice - trade.entry_price) : (trade.entry_price - currentPrice);

            if (pnl >= risk && trade.sl_price !== trade.entry_price) {
                console.log(`[Sentinel] ${symbol} -> BREAKEVEN`);
                await supabase.from('trades').update({ sl_price: trade.entry_price }).eq('id', trade.id);
            }

            let exit = false;
            let finalPnl = 0;
            if (trade.side === 'BUY') {
                if (currentPrice <= trade.sl_price) { exit = true; finalPnl = ((trade.sl_price - trade.entry_price) / trade.entry_price) * 100; }
                else if (currentPrice >= trade.tp_price) { exit = true; finalPnl = ((trade.tp_price - trade.entry_price) / trade.entry_price) * 100; }
            } else {
                if (currentPrice >= trade.sl_price) { exit = true; finalPnl = ((trade.entry_price - trade.sl_price) / trade.entry_price) * 100; }
                else if (currentPrice <= trade.tp_price) { exit = true; finalPnl = ((trade.entry_price - trade.tp_price) / trade.entry_price) * 100; }
            }

            if (exit) {
                await supabase.from('trades').update({ status: 'CLOSED', pnl: finalPnl, closed_at: new Date().toISOString() }).eq('id', trade.id);
            }
        }
    } catch (e) {}
}

async function sendTelegram(symbol, signalData) {
   if (!botToken || !chatId || signalData.signal === 'HOLD') return;
   const action = signalData.signal === 'BUY' ? '🟢 BUY' : '🔴 SELL';
   const message = `
<b>🚨 CLOUD SENTINEL ALERT 🚨</b>
<b>Asset:</b> ${symbol}
<b>Action:</b> ${action}
<b>Conviction:</b> ${(signalData.confidence * 100).toFixed(1)}%

<b>Entry:</b> ${signalData.entry.toFixed(5)}
<b>SL/TP:</b> ${signalData.sl.toFixed(5)} / ${signalData.tp.toFixed(5)}
<i>Status: Unified Portfolio Sync Active.</i>`;

   try {
     await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
     });
   } catch(e) {}
}

async function runSentinel() {
    console.log("⏱️ [Sentinel] Starting autonomous scan...");
    const aggregator = new CloudSignalAggregator();

    for (const sym of AVAILABLE_SYMBOLS) {
        try {
            const url1h = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1h&outputsize=250&apikey=${twelveDataKey}`;
            const url4h = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=4h&outputsize=250&apikey=${twelveDataKey}`;
            const [r1, r4] = await Promise.all([fetch(url1h), fetch(url4h)]);
            const [d1, d4] = await Promise.all([r1.json(), r4.json()]);

            const c1h = d1.values.map(v => ({ datetime: v.datetime, open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close) })).reverse();
            const c4h = d4.values.map(v => ({ datetime: v.datetime, open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close) })).reverse();

            const features = FeatureEngine.extractFeatures(c1h);
            const latest = FeatureEngine.enrichWithMacroTrend(features, c4h).pop();

            await manageOpenTrades(sym, latest.close);

            const result = await aggregator.evaluate(sym, latest);
            if (result && result.signal !== 'HOLD' && result.confidence > 0.45) {
                if ((result.signal === 'BUY' && latest.macro_trend === -1) || (result.signal === 'SELL' && latest.macro_trend === 1)) continue;
                await logTrade(sym, result);
                await sendTelegram(sym, result);
            }
        } catch(e) { console.error(`[Sentinel] ${sym} Error:`, e.message); }
    }
    process.exit(0);
}

runSentinel();
