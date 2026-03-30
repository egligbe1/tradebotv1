import { useStore } from '../store/useStore.js';

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

    const action = signalData.signal === 'BUY' ? '🟢 BUY' : '🔴 SELL';
    const conf = (signalData.confidence * 100).toFixed(1);
    
    // Using Discord/Telegram friendly Markdown
    const message = `
🚨 *TRADEBOT SIGNAL* 🚨
*Asset:* ${symbol}
*Action:* ${action}
*Conviction:* ${conf}%

*Entry:* ${signalData.entry}
*Stop Loss:* ${signalData.stop_loss}
*Take Profit 1:* ${signalData.take_profit_1}
*Take Profit 2:* ${signalData.take_profit_2}

_Models Aligned: Rule Engine, LSTM, RF, Logistic Regression_
_Trend Filter: Aligned with Daily 200 EMA_`;

    const url = `https://api.telegram.org/bot${activeToken}/sendMessage`;
    
    try {
      console.log(`[TelegramService] Attempting to send signal to Chat ID: ${activeId}...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: activeId,
          text: message,
          parse_mode: 'Markdown'
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
