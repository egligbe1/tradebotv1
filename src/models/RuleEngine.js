export class RuleEngine {
  name = 'RuleEngine';

  // ── Private scoring helpers ─────────────────────────────────────────────

  _trendStrengthScore(row) {
    let buy = 0; let sell = 0;
    const { adx, di_alignment } = row;
    if (adx !== null && adx > 25) { buy += 2; sell += 2; }  // confirmed trend → both sides
    if (adx !== null && adx < 18) { buy -= 2; sell -= 2; }  // ranging → suppress
    if (di_alignment === 1)  buy  += 1;
    if (di_alignment === -1) sell += 1;
    return { buy, sell };
  }

  _oscillatorScore(row) {
    let buy = 0; let sell = 0;
    const { rsi, rsi_bull_div, rsi_bear_div, macd_hist, macd_hist_lag1, stoch_k, stoch_d } = row;
    if (rsi && rsi < 30) buy  += 2;
    if (rsi && rsi > 70) sell += 2;
    if (rsi_bull_div === 1) buy  += 3;
    if (rsi_bear_div === 1) sell += 3;
    if (macd_hist > 0 && macd_hist_lag1 < 0) buy  += 1;
    if (macd_hist < 0 && macd_hist_lag1 > 0) sell += 1;
    if (stoch_k > stoch_d && stoch_d < 20)   buy  += 1;
    if (stoch_k < stoch_d && stoch_d > 80)   sell += 1;
    return { buy, sell };
  }

  _emaAlignmentScore(row) {
    let buy = 0; let sell = 0;
    const { close, ema9, ema21, ema50, ema9_gt_21, ema21_gt_50, obv_trend } = row;
    if (close > ema50) buy  += 1;
    if (close < ema50) sell += 1;
    if (ema9 > ema21 && ema21 > ema50) buy  += 2;  // full bullish stack
    if (ema9 < ema21 && ema21 < ema50) sell += 2;  // full bearish stack
    if (ema9_gt_21  === 1) buy  += 1;
    if (ema9_gt_21  === 0) sell += 1;
    if (ema21_gt_50 === 1) buy  += 1;
    if (ema21_gt_50 === 0) sell += 1;
    if (obv_trend   === 1)  buy  += 1;
    if (obv_trend   === -1) sell += 1;
    return { buy, sell };
  }

  _volatilityContextScore(row) {
    let buy = 0; let sell = 0;
    const { bb_pct_b, squeeze_on, macd_hist, macro_trend, is_overlap } = row;
    if (bb_pct_b !== null && bb_pct_b < 0.2) buy  += 1;
    if (bb_pct_b !== null && bb_pct_b > 0.8) sell += 1;
    if (squeeze_on === 0 && macd_hist > 0)   buy  += 1;  // squeeze released upward
    if (squeeze_on === 0 && macd_hist < 0)   sell += 1;  // squeeze released downward
    if (macro_trend === 1)  buy  += 1;
    if (macro_trend === -1) sell += 1;
    if (is_overlap  === 1)  { buy += 1; sell += 1; }     // high-liquidity session
    return { buy, sell };
  }

  _srProximityScore(row) {
    let buy = 0; let sell = 0;
    const { dist_to_support, dist_to_resistance, pivot_dist } = row;
    if (dist_to_support    !== null && dist_to_support    < 0.001) buy  += 1;
    if (dist_to_resistance !== null && dist_to_resistance < 0.001) sell += 1;
    if (pivot_dist !== null && pivot_dist > 0 && Math.abs(pivot_dist) < 0.001) buy  += 1;
    if (pivot_dist !== null && pivot_dist < 0 && Math.abs(pivot_dist) < 0.001) sell += 1;
    return { buy, sell };
  }

  _confluenceBonus(row) {
    const { trigger_engulfing, trigger_pinbar, trigger_star, dist_to_support, dist_to_resistance } = row;
    const nearSupport    = dist_to_support    !== null && dist_to_support    < 0.002;
    const nearResistance = dist_to_resistance !== null && dist_to_resistance < 0.002;
    const bullPattern    = trigger_engulfing === 1  || trigger_pinbar === 1  || trigger_star === 1;
    const bearPattern    = trigger_engulfing === -1 || trigger_pinbar === -1 || trigger_star === -1;
    return {
      buy:  nearSupport    && bullPattern ? 4 : 0,
      sell: nearResistance && bearPattern ? 4 : 0,
    };
  }

  _patternScore(row) {
    let buy = 0; let sell = 0;
    const { trigger_engulfing, trigger_pinbar, trigger_star, vol_ratio } = row;

    if (trigger_engulfing === 1)  buy  += 2;
    if (trigger_engulfing === -1) sell += 2;
    if (trigger_pinbar    === 1)  buy  += 2;
    if (trigger_pinbar    === -1) sell += 2;
    if (trigger_star      === 1)  buy  += 3;
    if (trigger_star      === -1) sell += 3;

    // Volume-confirmed engulfing
    if (vol_ratio > 1.5 && trigger_engulfing === 1)  buy  += 2;
    if (vol_ratio > 1.5 && trigger_engulfing === -1) sell += 2;

    const conf = this._confluenceBonus(row);
    return { buy: buy + conf.buy, sell: sell + conf.sell };
  }

  _marketStructureScore(row) {
    let buy = 0; let sell = 0;
    if (row.ms_structure === 'BULLISH') { buy += 4; sell -= 6; }
    if (row.ms_structure === 'BEARISH') { sell += 4; buy  -= 6; }
    return { buy, sell };
  }

  // Smart-money price action: liquidity sweeps (stop hunts) and fair-value gaps.
  // A sweep of liquidity at a level, reclaimed, is one of the highest-quality
  // reversal reads an experienced price-action trader waits for.
  _smartMoneyScore(row) {
    let buy = 0; let sell = 0;
    const { liq_sweep, fvg_signal, dist_to_support, dist_to_resistance } = row;
    const nearSupport = dist_to_support !== null && dist_to_support < 0.0025;
    const nearResistance = dist_to_resistance !== null && dist_to_resistance < 0.0025;

    if (liq_sweep === 1) buy += nearSupport ? 4 : 2;    // swept lows & reclaimed
    if (liq_sweep === -1) sell += nearResistance ? 4 : 2; // swept highs & rejected
    if (fvg_signal === 1) buy += 1;                       // bullish imbalance
    if (fvg_signal === -1) sell += 1;                     // bearish imbalance
    return { buy, sell };
  }

  // ── Public predict ──────────────────────────────────────────────────────

  predict(latestRow) {
    if (!latestRow) return { signal: 'HOLD', score: 0, probability: 0.5 };

    const scores = [
      this._trendStrengthScore(latestRow),
      this._oscillatorScore(latestRow),
      this._emaAlignmentScore(latestRow),
      this._volatilityContextScore(latestRow),
      this._srProximityScore(latestRow),
      this._patternScore(latestRow),
      this._marketStructureScore(latestRow),
      this._smartMoneyScore(latestRow),
    ];

    let buyScore  = 0;
    let sellScore = 0;
    for (const s of scores) { buyScore += s.buy; sellScore += s.sell; }

    let signal = 'HOLD';
    let probability = 0.5;

    // Threshold 7 requires multiple confluence factors to align
    if (buyScore >= 7 && buyScore > sellScore) {
      signal = 'BUY';
      probability = 0.5 + Math.min(buyScore, 16) / 32;
    } else if (sellScore >= 7 && sellScore > buyScore) {
      signal = 'SELL';
      probability = 0.5 - Math.min(sellScore, 16) / 32;
    }

    return { signal, reasonScore: { buyScore, sellScore }, probability };
  }
}
