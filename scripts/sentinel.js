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
const LOOKBACK = 24;

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
    // 1. Fetch latest weights from Supabase
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

    // Logistic
    if (models.logistic) {
      const { theta } = models.logistic;
      let z = theta[0]; 
      for (let i = 0; i < FEATURES_22.length; i++) {
        z += theta[i+1] * (latestFeature[FEATURES_22[i]] || 0);
      }
      probs.push(1 / (1 + Math.exp(-z)));
    }

    // RF
    if (models.randomforest) {
      const rf = RFClassifier.fromJSON(models.randomforest);
      const rowData = FEATURES_22.map(f => latestFeature[f] || 0);
      probs.push(rf.predictProbability([rowData], 1)[0]);
    }

    // LSTM (Complex due to 3D tensor requirement)
    if (models.lstm && tf) {
        try {
            // This is simplified; in a production-ready sentinel we'd want to handle the 3D tensor sequence
            // For now, we'll rely on the weighted consensus of Logistic + RF if LSTM is too heavy for a quick script
        } catch(e) {}
    }

    const meanProb = probs.reduce((a, b) => a + b, 0) / probs.length;
    const conviction = Math.abs(meanProb - 0.5) * 2;
    const signal = meanProb > 0.55 ? 'BUY' : (meanProb < 0.45 ? 'SELL' : 'HOLD');
    
    return { signal, confidence: conviction, entry: latestFeature.close };
  }
}

async function sendTelegram(symbol, signalData) {
   if (!botToken || !chatId || signalData.signal === 'HOLD') return;

   const activeId = chatId;
   const action = signalData.signal === 'BUY' ? '🟢 BUY' : '🔴 SELL';
   const conf = (signalData.confidence * 100).toFixed(1);
   
   const message = `
<b>🚨 CLOUD SENTINEL ALERT 🚨</b>
<b>Asset:</b> ${symbol}
<b>Action:</b> ${action}
<b>Conviction:</b> ${conf}%

<b>Entry:</b> ${signalData.entry}
<i>Status: Autonomous Cloud Signal detected via GitHub Actions.</i>`;

   const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
   try {
     const res = await fetch(url, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ chat_id: activeId, text: message, parse_mode: 'HTML' })
     });
     if (res.ok) console.log(`[Sentinel] ✅ Alert sent for ${symbol}`);
   } catch(e) {
     console.error(`[Sentinel] ❌ Failed to send Telegram:`, e.message);
   }
}

async function runSentinel() {
    console.log("⏱️ [Sentinel] Starting autonomous scan...");
    const aggregator = new CloudSignalAggregator();

    for (const sym of AVAILABLE_SYMBOLS) {
        try {
            const url = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1h&outputsize=510&apikey=${twelveDataKey}`;
            const res = await fetch(url);
            const data = await res.json();
            
            if (!data.values || data.status === 'error') throw new Error(data.message);

            const candles = data.values.map(d => ({
                open: parseFloat(d.open), high: parseFloat(d.high),
                low: parseFloat(d.low), close: parseFloat(d.close)
            })).reverse();

            const features = FeatureEngine.extractFeatures(candles);
            const latest = features[features.length - 1];

            const result = await aggregator.evaluate(sym, latest);
            if (result && result.signal !== 'HOLD' && result.confidence > 0.45) {
                await sendTelegram(sym, result);
            } else {
                console.log(`[Sentinel] ${sym}: Neutral (${(result?.confidence * 100 || 0).toFixed(1)}% conviction)`);
            }
        } catch(e) {
            console.error(`[Sentinel] Error scanning ${sym}:`, e.message);
        }
    }
    console.log("🏁 [Sentinel] Cycle complete.");
    process.exit(0);
}

runSentinel();
