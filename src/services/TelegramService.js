export class TelegramService {
  constructor() {
    this.botToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
    this.chatId = import.meta.env.VITE_TELEGRAM_CHAT_ID;
    this.enabled = !!(this.botToken && this.chatId);
  }

  async sendAlert(symbol, signalData) {
    if (!this.enabled || signalData.signal === 'HOLD') {
       if (!this.enabled && signalData.signal !== 'HOLD') {
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

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
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
