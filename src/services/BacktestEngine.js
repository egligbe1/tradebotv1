import { FeatureEngine } from './FeatureEngine.js';
import { signalAggregator } from './SignalAggregator.js';
import { getCostModel } from '@/lib/assetConfig';

export class BacktestEngine {
  /**
   * Runs a historical simulation on a symbol
   * @param {string} symbol - e.g. "EUR/USD"
   * @param {Array} candles1h - Array of 1h candles
   * @param {Array} candles4h - Array of 4h candles
   * @param {number} initialBalance - Starting capital (default 10000)
   * @param {number} riskPerTrade - % of balance to risk (default 1)
   */
  async run(symbol, candles1h, candles4h, initialBalance = 10000, riskPerTrade = 0.01) {
    if (!candles1h || candles1h.length < 300) {
      throw new Error("Insufficient history for backtesting (need 300+ 1H candles)");
    }

    console.log(`[BacktestEngine] 🧪 Starting simulation for ${symbol} on ${candles1h.length} candles...`);

    // Realistic per-asset trading costs (spread + slippage + commission),
    // expressed as a fraction of price and charged once per round-trip trade.
    const cost = getCostModel(symbol);
    const roundTripCost = cost.roundTrip;

    // 1. Prepare Features (Offline static prep)
    const features1h = FeatureEngine.extractFeatures(candles1h);
    FeatureEngine.enrichWithMacroTrend(features1h, candles4h);

    const trades = [];
    let balance = initialBalance;
    let equityCurve = [{ time: features1h[0].datetime, value: initialBalance }];
    let activeTrade = null;

    // Start from index 200 to ensure EMAs are warm
    for (let i = 200; i < features1h.length; i++) {
      const currentBar = features1h[i];
      const prevBar = features1h[i - 1];

      // A. Check if active trade was hit
      if (activeTrade) {
        const high = currentBar.high;
        const low = currentBar.low;
        
        let exitPrice = null;
        let result = null;

        if (activeTrade.side === 'BUY') {
          if (low <= activeTrade.sl) {
            exitPrice = activeTrade.sl;
            result = 'LOSS';
          } else if (high >= activeTrade.tp) {
            exitPrice = activeTrade.tp;
            result = 'WIN';
          }
        } else {
          if (high >= activeTrade.sl) {
            exitPrice = activeTrade.sl;
            result = 'LOSS';
          } else if (low <= activeTrade.tp) {
            exitPrice = activeTrade.tp;
            result = 'WIN';
          }
        }

        if (exitPrice) {
          const grossPercent = activeTrade.side === 'BUY'
            ? (exitPrice - activeTrade.entry) / activeTrade.entry
            : (activeTrade.entry - exitPrice) / activeTrade.entry;

          // Charge realistic round-trip cost (spread + slippage + commission).
          const pnlPercent = grossPercent - roundTripCost;
          const pnlCash = activeTrade.positionSize * pnlPercent;
          balance += pnlCash;
          
          // Net result after costs (a TP that barely covers spread can still lose).
          const netResult = pnlPercent > 0 ? 'WIN' : 'LOSS';
          trades.push({
            ...activeTrade,
            exit: exitPrice,
            exitTime: currentBar.datetime,
            result: netResult,
            barrier: result,
            pnlCash,
            pnlPercent: pnlPercent * 100,
            finalBalance: balance
          });
          
          activeTrade = null;
        }
      }

      // B. Scan for New Signals (only if no active trade)
      if (!activeTrade) {
        // We only look at features up to index i to avoid look-ahead bias
        const subFeatures = features1h.slice(0, i + 1);
        const signalResult = await signalAggregator.generateSignal(subFeatures, currentBar.close);

        if (signalResult && signalResult.signal !== 'HOLD') {
          // Dynamic Risk Management
          const dollarRisk = balance * riskPerTrade;
          const stopDist = Math.abs(currentBar.close - signalResult.stop_loss);
          const positionSize = stopDist > 0 ? dollarRisk / (stopDist / currentBar.close) : balance;

          activeTrade = {
            symbol,
            side: signalResult.signal,
            entry: currentBar.close,
            entryTime: currentBar.datetime,
            sl: signalResult.stop_loss,
            tp: signalResult.take_profit_1,
            positionSize,
            confidence: signalResult.confidence
          };
        }
      }

      equityCurve.push({ time: currentBar.datetime, value: balance });
    }

    // C. Calculate Metrics
    const wins = trades.filter(t => t.result === 'WIN');
    const losses = trades.filter(t => t.result === 'LOSS');
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

    const profitFactor = this._calculateProfitFactor(trades);
    const maxDrawdown = this._calculateMaxDrawdown(equityCurve);

    const avgWinPct = wins.length ? wins.reduce((a, t) => a + t.pnlPercent, 0) / wins.length : 0;
    const avgLossPct = losses.length ? losses.reduce((a, t) => a + t.pnlPercent, 0) / losses.length : 0;
    // Expectancy per trade in % of risked capital terms (simple per-trade mean).
    const expectancyPct = trades.length
      ? trades.reduce((a, t) => a + t.pnlPercent, 0) / trades.length : 0;
    const sharpe = this._calculateSharpe(trades);

    return {
      symbol,
      initialBalance,
      finalBalance: balance,
      totalReturn: ((balance - initialBalance) / initialBalance) * 100,
      tradesCount: trades.length,
      winRate,
      profitFactor,
      maxDrawdown,
      avgWinPct,
      avgLossPct,
      expectancyPct,
      sharpe,
      costModel: { roundTripCostPct: roundTripCost * 100, assetClass: cost.assetClass },
      trades,
      equityCurve
    };
  }

  /**
   * Sharpe ratio of the per-trade return distribution (not annualized — a
   * comparable, unitless quality measure across assets). Returns 0 with <2 trades.
   */
  _calculateSharpe(trades) {
    if (trades.length < 2) return 0;
    const rets = trades.map(t => t.pnlPercent);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    const std = Math.sqrt(variance);
    return std > 0 ? mean / std : 0;
  }

  _calculateProfitFactor(trades) {
    const grossProfit = trades.filter(t => t.pnlCash > 0).reduce((a, b) => a + b.pnlCash, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnlCash < 0).reduce((a, b) => a + b.pnlCash, 0));
    return grossLoss === 0 ? grossProfit : grossProfit / grossLoss;
  }

  _calculateMaxDrawdown(equityCurve) {
    let peak = -Infinity;
    let maxDd = 0;
    for (const point of equityCurve) {
      if (point.value > peak) peak = point.value;
      const dd = (peak - point.value) / peak;
      if (dd > maxDd) maxDd = dd;
    }
    return maxDd * 100;
  }
  
  /**
   * Alias for run() to maintain backward compatibility with older pages.
   */
  async runBacktest(candles1h) {
    // Attempt to fetch 4h candles if we have a way to do so, otherwise pass null
    return this.run("BACKTEST", candles1h, null);
  }
}

export const backtestEngine = new BacktestEngine();
export default backtestEngine;
