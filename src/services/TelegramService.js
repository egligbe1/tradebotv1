import { useStore } from '../store/useStore.js';
import { buildSignalMessage, isTelegramWindowOpen } from '../lib/signalMessage.js';

export class TelegramService {
  constructor() {
    // Service state managed via store in sendAlert
  }

  async sendAlert(symbol, signalData) {
    const { telegramBotToken, telegramChatId } = useStore.getState();
    const activeToken = telegramBotToken || import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
    const activeId = telegramChatId || import.meta.env.VITE_TELEGRAM_CHAT_ID;
    const isConfigured = !!(activeToken && activeId);

    if (!isConfigured || signalData.signal === 'HOLD') {
        if (!isConfigured && signalData.signal !== 'HOLD') {
            console.log(`[TelegramService] SKIPPED (Not configured): 🚨 ${signalData.signal} ${symbol}`);
        }
        return;
    }

    // Only alert during the 08:00–15:00 GMT window (London + early NY).
    if (!isTelegramWindowOpen()) {
        console.log(`[TelegramService] SKIPPED (outside 08:00–15:00 GMT window): ${signalData.signal} ${symbol}`);
        return;
    }

    const message = buildSignalMessage(symbol, {
      signal: signalData.signal,
      confidence: signalData.confidence,
      entry: signalData.entry,
      stopLoss: signalData.stop_loss,
      tp1: signalData.take_profit_1,
      tp2: signalData.take_profit_2,
      modelsAligned: signalData.models_aligned,
      trendFilter: signalData.trend_filter,
    });

    const url = `https://api.telegram.org/bot${activeToken}/sendMessage`;
    
    try {
      console.log(`[TelegramService] Attempting to send signal to Chat ID: ${activeId}...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: activeId,
          text: message,
          parse_mode: 'HTML'
        })
      });
      
      const responseData = await res.json();

      if (!res.ok) {
         throw new Error(responseData.description || `Telegram API Error: ${res.status}`);
      }
      console.log(`[TelegramService] ✅ Success! Message delivered to Telegram servers.`);
    } catch(e) {
      console.error(`[TelegramService] ❌ Delivery Failed:`, e.message);
      throw e; // Re-throw so the UI can catch it!
    }
  }
}

export const telegramService = new TelegramService();
