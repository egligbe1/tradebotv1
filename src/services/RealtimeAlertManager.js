import { AVAILABLE_SYMBOLS } from '../store/useStore.js';
import { dataManager } from './DataManager.js';
import { FeatureEngine } from './FeatureEngine.js';
import { signalAggregator } from './SignalAggregator.js';
import { telegramService } from './TelegramService.js';
import { newsFilterService } from './NewsFilterService.js';
import { createClient } from '@supabase/supabase-js';
import { tradeManager } from './TradeManager.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export class RealtimeAlertManager {
  constructor() {
    this.timerId = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNextRun();
    console.log("⏱️ [AlertSentinel] Armed. Waiting for the exact top of the hour to strike...");
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) clearTimeout(this.timerId);
  }

  scheduleNextRun() {
    if (!this.isRunning) return;
    const now = new Date();
    
    // Calculate milliseconds exactly until the next top of the hour + 3 seconds padding for APIs to finalize
    const msUntilNextHour = (60 - now.getMinutes()) * 60000 - (now.getSeconds() * 1000) - now.getMilliseconds() + 3000;
    
    this.timerId = setTimeout(() => {
       this.executeScan();
    }, msUntilNextHour);
    
    console.log(`[AlertSentinel] Next live scan executing in ${(msUntilNextHour / 60000).toFixed(2)} minutes.`);
  }

  async executeScan() {
    console.log("[AlertSentinel] WAKING UP! Processing the latest closed 1H candles across all assets.");
    
    for (const sym of AVAILABLE_SYMBOLS) {
        try {
            const res1h = await dataManager.getCandles(sym, '1h', 250); 
            const res4h = await dataManager.getCandles(sym, '4h', 250); // For macro trend
            
            const candles = res1h.values;
            const macroCandles = res4h.values;

            if (!candles || candles.length < 200) {
               console.error(`[AlertSentinel] Skipped ${sym}: Insufficient liquidity data.`);
               continue;
            }

            // High-Impact Economic Evasion Kill Switch
            const safeToTrade = await newsFilterService.isSafeToTrade(sym, 2); // 2 hours padding
            if (!safeToTrade) {
               console.log(`[AlertSentinel] Skipped ${sym}: Tier-1 News Volatility Blockade active.`);
               continue;
            }

            const features = FeatureEngine.extractFeatures(candles);
            const currentPrice = candles[candles.length - 1].close;

            // 0. Manage existing open trades (Breakeven/Exit)
            await tradeManager.manageOpenTrades(sym, currentPrice);
            
            // Execute institutional-grade cross-model alignment verify with Macro confirmation
            const signalData = await signalAggregator.generateSignal(features, currentPrice, macroCandles);
            
            if (signalData && signalData.signal !== 'HOLD') {
                console.log(`[AlertSentinel] 🔥 HIGH CONVICTION SIGNAL CAUGHT for ${sym}: ${signalData.signal} 🔥`);
                
                // 1. Log to institutional portfolio (Supabase)
                try {
                    await supabase.from('trades').insert({
                        symbol: sym,
                        side: signalData.signal,
                        entry_price: signalData.entry,
                        sl_price: signalData.stop_loss,
                        tp_price: signalData.take_profit_1,
                        status: 'OPEN'
                    });
                } catch (dbErr) {
                    console.error("[AlertSentinel] Failed to log trade to Supabase:", dbErr.message);
                }

                // 2. Push to Telegram (Mobile)
                await telegramService.sendAlert(sym, signalData);

                // 3. Push to Browser (Desktop)
                import('./NotificationManager.js').then(m => {
                   m.notificationManager.notifySignal(signalData, sym);
                });
            }
        } catch(e) {
            console.error(`[AlertSentinel] Engine error scanning ${sym}:`, e.message);
        }
    }
    
    // Recurring loop
    this.scheduleNextRun();
  }
}

export const realtimeAlertManager = new RealtimeAlertManager();
