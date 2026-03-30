import { AVAILABLE_SYMBOLS } from '../store/useStore.js';
import { dataManager } from './DataManager.js';
import { FeatureEngine } from './FeatureEngine.js';
import { signalAggregator } from './SignalAggregator.js';
import { telegramService } from './TelegramService.js';
import { newsFilterService } from './NewsFilterService.js';

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
            await dataManager.getCandles(sym, '1h', 250); // 200 required for EMA200 regime filter
            const candles = dataManager.cache[sym];
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
            const currentPrice = candles[0].close;
            
            // Execute institutional-grade cross-model alignment verify
            const signalData = await signalAggregator.generateSignal(features, currentPrice);
            
            if (signalData && signalData.signal !== 'HOLD') {
                console.log(`[AlertSentinel] 🔥 HIGH CONVICTION SIGNAL CAUGHT for ${sym}: ${signalData.signal} 🔥`);
                
                // 1. Push to Telegram (Mobile)
                await telegramService.sendAlert(sym, signalData);

                // 2. Push to Browser (Desktop)
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
