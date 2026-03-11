import { FeatureEngine } from '@/services/FeatureEngine';
import { signalAggregator } from '@/services/SignalAggregator';

export class BacktestEngine {
  constructor() {
    this.name = 'BacktestEngine';
  }

  /**
   * Run a historical simulation over a set of candles
   * @param {Array} candles - Array of OHLCV candles
   */
  async runBacktest(candles) {
    if (!candles || candles.length < 200) {
       throw new Error("Insufficient candles for backtesting. Minimum 200 required for feature warmup.");
    }

    const trades = [];
    const minLookback = 50; // LSTM needs 24 seq, FeatureEngine needs ~33. Let's start trading at index 50
    let equity = 100.0; // Starting unit
    const equityCurve = [{ index: 0, equity: 100.0 }];

    // We pre-calculate all features, but feed them to aggregator sequentially
    const allFeatures = FeatureEngine.extractFeatures(candles);

    let activeTrade = null;

    // Simulate stepping through time
    for (let i = minLookback; i < candles.length; i++) {
       const currentCandle = candles[i];
       
       // 1. Manage existing trade if open
       if (activeTrade) {
           let closed = false;
           let exitPrice = 0;
           let pnl = 0;
           
           if (activeTrade.side === 'BUY') {
              if (currentCandle.low <= activeTrade.stopLoss) {
                 closed = true;
                 exitPrice = activeTrade.stopLoss;
                 pnl = -1.0; // 1 Risk Unit lost
                 activeTrade.result = 'LOSS';
              } else if (currentCandle.high >= activeTrade.takeProfit1) {
                 closed = true;
                 exitPrice = activeTrade.takeProfit1;
                 pnl = 2.0; // 2 Risk Units gained (1:2 RR)
                 activeTrade.result = 'WIN';
              }
           } else if (activeTrade.side === 'SELL') {
              if (currentCandle.high >= activeTrade.stopLoss) {
                 closed = true;
                 exitPrice = activeTrade.stopLoss;
                 pnl = -1.0;
                 activeTrade.result = 'LOSS';
              } else if (currentCandle.low <= activeTrade.takeProfit1) {
                 closed = true;
                 exitPrice = activeTrade.takeProfit1;
                 pnl = 2.0;
                 activeTrade.result = 'WIN';
              }
           }

           if (closed) {
               activeTrade.exitPrice = exitPrice;
               activeTrade.exitTime = currentCandle.datetime;
               activeTrade.pnlUnits = pnl;
               equity += pnl;
               equityCurve.push({ index: i, equity, time: currentCandle.datetime });
               trades.push(activeTrade);
               activeTrade = null;
               // Skip generating a new signal on the exit candle to simulate reaction delay
               continue; 
           }
       }

       // 2. Generate new signal if no active trade
       if (!activeTrade) {
           // Provide features UP TO this point in time
           const featuresUpToNow = allFeatures.slice(0, i + 1);
           
           // Await the signal (Note: this is heavy in a loop for LSTM, but it's a browser-side backtest)
           const signalObj = await signalAggregator.generateSignal(featuresUpToNow, currentCandle.close);

           if (signalObj && (signalObj.signal === 'BUY' || signalObj.signal === 'SELL')) {
               activeTrade = {
                  id: i,
                  entryTime: currentCandle.datetime,
                  side: signalObj.signal,
                  entryPrice: currentCandle.close,
                  stopLoss: signalObj.stop_loss,
                  takeProfit1: signalObj.take_profit_1,
                  confidence: signalObj.confidence,
                  status: 'OPEN'
               };
           }
       }
    }

    // Force close active trade at end of simulation if still open
    if (activeTrade) {
        activeTrade.result = 'OPEN (EOD)';
        activeTrade.pnlUnits = 0;
        trades.push(activeTrade);
    }

    // Calculate metrics
    const completedTrades = trades.filter(t => t.result === 'WIN' || t.result === 'LOSS');
    const wins = completedTrades.filter(t => t.result === 'WIN').length;
    const losses = completedTrades.filter(t => t.result === 'LOSS').length;
    
    // Drawdown calculation
    let peak = 100.0;
    let maxDrawdown = 0;
    equityCurve.forEach(point => {
        if (point.equity > peak) peak = point.equity;
        const dd = (peak - point.equity) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
    });

    return {
        trades,
        equityCurve,
        metrics: {
            totalTrades: completedTrades.length,
            winRate: completedTrades.length > 0 ? (wins / completedTrades.length) : 0,
            netUnits: equity - 100.0,
            maxDrawdown: maxDrawdown,
            profitFactor: losses > 0 ? ((wins * 2.0) / (losses * 1.0)) : (wins > 0 ? 99 : 0) // Assume RR 1:2
        }
    };
  }
}

export const backtestEngine = new BacktestEngine();
