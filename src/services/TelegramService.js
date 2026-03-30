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
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: activeId,
          text: message,
          parse_mode: 'Markdown'
        })
      });
      
      if (!res.ok) {
         const err = await res.text();
         throw new Error(`Telegram API Error: ${err}`);
      }
      console.log(`[TelegramService] Pushed ultra-low latency alert for ${symbol} to Phone.`);
    } catch(e) {
      console.error(`[TelegramService] Webhook payload failed:`, e.message);
    }
  }
}

export const telegramService = new TelegramService();
