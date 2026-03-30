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
    
    // Switch to HTML for 100% reliability (avoid unescaped _ or *)
    const message = `
<b>🚨 TRADEBOT SIGNAL 🚨</b>
<b>Asset:</b> ${symbol}
<b>Action:</b> ${action}
<b>Conviction:</b> ${conf}%

<b>Entry:</b> ${signalData.entry}
<b>Stop Loss:</b> ${signalData.stop_loss}
<b>Take Profit 1:</b> ${signalData.take_profit_1}
<b>Take Profit 2:</b> ${signalData.take_profit_2}

<i>Models Aligned: Rule Engine, LSTM, RF, Logistic Regression</i>
<i>Trend Filter: Aligned with Daily 200 EMA</i>`;

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
