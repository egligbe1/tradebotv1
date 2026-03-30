import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export class TradeManager {
  /**
   * Scans open trades and updates them (Breakeven, Exit, etc)
   * @param {string} symbol - The symbol being scanned
   * @param {number} currentPrice - Latest close price
   */
  async manageOpenTrades(symbol, currentPrice) {
    try {
      const { data: openTrades, error } = await supabase
        .from('trades')
        .select('*')
        .eq('symbol', symbol)
        .eq('status', 'OPEN');

      if (error || !openTrades) return;

      for (const trade of openTrades) {
        // A. Check for Breakeven (1:1 Risk Reward reached)
        const risk = Math.abs(trade.entry_price - trade.sl_price);
        const pnl = trade.side === 'BUY' 
          ? (currentPrice - trade.entry_price) 
          : (trade.entry_price - currentPrice);

        // If profit > risk, move SL to entry (Breakeven)
        if (pnl >= risk && trade.sl_price !== trade.entry_price) {
          console.log(`[TradeManager] Moving ${symbol} trade to BREAKEVEN!`);
          await supabase
            .from('trades')
            .update({ sl_price: trade.entry_price })
            .eq('id', trade.id);
        }

        // B. Check for Exit (Hard SL or TP hit)
        let exitTriggered = false;
        let finalPnl = 0;

        if (trade.side === 'BUY') {
          if (currentPrice <= trade.sl_price) {
            exitTriggered = true;
            finalPnl = ((trade.sl_price - trade.entry_price) / trade.entry_price) * 100;
          } else if (currentPrice >= trade.tp_price) {
            exitTriggered = true;
            finalPnl = ((trade.tp_price - trade.entry_price) / trade.entry_price) * 100;
          }
        } else {
          if (currentPrice >= trade.sl_price) {
            exitTriggered = true;
            finalPnl = ((trade.entry_price - trade.sl_price) / trade.entry_price) * 100;
          } else if (currentPrice <= trade.tp_price) {
            exitTriggered = true;
            finalPnl = ((trade.entry_price - trade.tp_price) / trade.entry_price) * 100;
          }
        }

        if (exitTriggered) {
          console.log(`[TradeManager] Closing ${symbol} trade. Result: ${finalPnl.toFixed(2)}%`);
          await supabase
            .from('trades')
            .update({ 
               status: 'CLOSED', 
               pnl: finalPnl, 
               closed_at: new Date().toISOString() 
            })
            .eq('id', trade.id);
        }
      }
    } catch (e) {
      console.error("[TradeManager] Management error:", e.message);
    }
  }
}

export const tradeManager = new TradeManager();
