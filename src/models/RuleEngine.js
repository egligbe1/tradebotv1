export class RuleEngine {
  constructor() {
    this.name = 'RuleEngine';
  }

  /**
   * Evaluates technical conditions on the latest feature row.
   * @param {Object} latestRow - The most recent feature matrix row
   * @returns {Object} { signal, score, probability }
   */
  predict(latestRow) {
    if (!latestRow) return { signal: 'HOLD', score: 0, probability: 0.5 };

    let buyScore = 0;
    let sellScore = 0;

    // BUY Conditions
    if (latestRow.rsi && latestRow.rsi < 35) buyScore += 1; // oversold
    
    // MACD histogram positive turn (needs lag data)
    // We assume the caller or FeatureEngine passed in the lagged hist.
    if (latestRow.macd_hist > 0 && latestRow.macd_hist_lag1 < 0) buyScore += 1;
    
    if (latestRow.close > latestRow.ema50) buyScore += 1; // Price above EMA50
    if (latestRow.bb_pct_b !== null && latestRow.bb_pct_b < 0.2) buyScore += 1; // Near lower band
    if (latestRow.ema9_gt_21 === 1) buyScore += 1; // Upward cross or bullish EMA alignment
    if (latestRow.macro_trend === 1) buyScore += 1; // Macro Bullish Alignment (4H)
    
    // Stochastic oversold cross
    if (latestRow.stoch_k > latestRow.stoch_d && latestRow.stoch_d < 20) buyScore += 1;
    if (latestRow.is_overlap === 1) buyScore += 1; // London/NY overlap (high liquidity)
    
    // SMART TRIGGERS (Engulfing/Pin Bar/SR)
    const nearSupport = latestRow.dist_to_support !== null && latestRow.dist_to_support < 0.002; // within 0.2%
    
    if (latestRow.trigger_engulfing === 1) buyScore += 2;
    if (latestRow.trigger_pinbar === 1) buyScore += 2;
    if (latestRow.trigger_star === 1) buyScore += 3; // Stars are Rare but Powerful
    
    // Confluence Bonus: Pattern + S/R Zone
    if (nearSupport && (latestRow.trigger_engulfing === 1 || latestRow.trigger_pinbar === 1 || latestRow.trigger_star === 1)) {
        buyScore += 4; // MASSIVE CONFLUENCE BOOST
    }

    if (latestRow.dist_to_support !== null && latestRow.dist_to_support < 0.001) buyScore += 1;
    if (latestRow.pivot_dist !== null && latestRow.pivot_dist > 0 && latestRow.pivot_dist < 0.001) buyScore += 1;


    // SELL Conditions
    if (latestRow.rsi && latestRow.rsi > 65) sellScore += 1; // overbought
    if (latestRow.macd_hist < 0 && latestRow.macd_hist_lag1 > 0) sellScore += 1;
    if (latestRow.close < latestRow.ema50) sellScore += 1; // Price below EMA50
    if (latestRow.bb_pct_b !== null && latestRow.bb_pct_b > 0.8) sellScore += 1; // Near upper band
    if (latestRow.ema9_gt_21 === 0) sellScore += 1; // Downward cross or bearish EMA alignment
    if (latestRow.macro_trend === -1) sellScore += 1; // Macro Bearish Alignment (4H)
    
    // Stochastic overbought cross
    if (latestRow.stoch_k < latestRow.stoch_d && latestRow.stoch_d > 80) sellScore += 1;

    // SMART TRIGGERS (Engulfing/Pin Bar/SR)
    const nearResistance = latestRow.dist_to_resistance !== null && latestRow.dist_to_resistance < 0.002;

    if (latestRow.trigger_engulfing === -1) sellScore += 2;
    if (latestRow.trigger_pinbar === -1) sellScore += 2;
    if (latestRow.trigger_star === -1) sellScore += 3;

    // Confluence Bonus: Pattern + S/R Zone
    if (nearResistance && (latestRow.trigger_engulfing === -1 || latestRow.trigger_pinbar === -1 || latestRow.trigger_star === -1)) {
        sellScore += 4; // MASSIVE CONFLUENCE BOOST
    }

    if (latestRow.dist_to_resistance !== null && latestRow.dist_to_resistance < 0.001) sellScore += 1;
    if (latestRow.pivot_dist !== null && latestRow.pivot_dist < 0 && Math.abs(latestRow.pivot_dist) < 0.001) sellScore += 1;


    // Evaluate deterministic rule outcome
    let signal = 'HOLD';
    let probability = 0.5; // neutral

    // We require 6+ conditions for "Very Accurate" entries
    if (buyScore >= 6) {
      signal = 'BUY';
      // Map score 6-12 into a probability 0.6 to 0.95
      probability = 0.5 + Math.min(buyScore, 12) / 24; 
    } else if (sellScore >= 6) {
      signal = 'SELL';
      // Map score 6-12 into a probability 0.4 to 0.05
      probability = 0.5 - Math.min(sellScore, 12) / 24;
    }

    return {
      signal,
      reasonScore: { buyScore, sellScore },
      probability
    };
  }
}
