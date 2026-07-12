/**
 * featureContract.js — SINGLE SOURCE OF TRUTH for the ML pipeline.
 *
 * Every place that trains or runs inference (browser models, cloud-train.js,
 * sentinel.js) MUST import FEATURE_NAMES and LABEL from here. Previously each
 * location hard-coded its own feature list (25 / 27 / 24 / 31 / 35 features),
 * so cloud-trained weights were applied against mismatched input vectors and
 * produced garbage. Never hard-code a feature list anywhere else.
 */

// Canonical, ordered list of model input features.
// Order is part of the contract: persisted weights/scalers assume this order.
export const FEATURE_NAMES = [
  // Price action (all price-relative → stationary & transferable across assets)
  'log_return', 'hl_range', 'body_size', 'upper_wick', 'lower_wick',
  // Momentum oscillators (macd normalized by price; rest are bounded)
  'rsi_norm', 'macd_hist_norm', 'stoch_k', 'stoch_d', 'cci', 'williams_r',
  // Volatility / bands
  'bb_pct_b', 'bb_width', 'atr_norm', 'squeeze_on',
  // Trend / EMA (distances as ratios, not raw levels)
  'trend_regime', 'trend_strength', 'ema9_gt_21', 'ema21_gt_50',
  // ADX / directional
  'adx_norm', 'di_alignment',
  // Volume
  'vol_ratio', 'obv_trend',
  // Support / resistance & market structure
  'dist_to_support', 'dist_to_resistance', 'pivot_dist', 'ms_structure_num',
  // Patterns, divergence & smart-money structure
  'trigger_engulfing', 'trigger_pinbar', 'rsi_bull_div', 'rsi_bear_div',
  'fvg_signal', 'liq_sweep',
  // Lags (short-term memory for non-sequential models)
  'return_lag1', 'return_lag2', 'return_lag3',
  // Session & macro context
  'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos', 'macro_trend',
];

export const FEATURE_COUNT = FEATURE_NAMES.length;

// Sequence length (number of H1 candles of context) for the LSTM.
export const LOOKBACK = 24;

// ── Directional label configuration (symmetric ATR triple-barrier) ──────────
//
// For each bar we place an UP barrier and a DOWN barrier at +/- (ATR * mult)
// and walk forward up to HORIZON bars. The FIRST barrier touched decides the
// label. This produces a genuine 3-class DIRECTIONAL target (down/flat/up),
// unlike the old long-only "did a +0.5% long win" binary that every model was
// wrongly interpreting as a symmetric buy/sell signal.
export const LABEL = {
  DOWN: 0,
  NEUTRAL: 1,
  UP: 2,
  HORIZON: 16,        // max holding period in bars
  BARRIER_ATR: 1.2,   // barrier distance = 1.2 * ATR(14)
  MIN_BARRIER_PCT: 0.0006, // floor so barriers aren't smaller than typical spread
};

export const CLASS_NAMES = ['DOWN', 'NEUTRAL', 'UP'];

/**
 * Extract the ordered numeric feature vector for a single feature row.
 * Missing / non-finite values become 0 (matches training-time null handling).
 * @param {object} row
 * @returns {number[]}
 */
export function rowToVector(row) {
  const v = new Array(FEATURE_COUNT);
  for (let i = 0; i < FEATURE_COUNT; i++) {
    const x = row[FEATURE_NAMES[i]];
    v[i] = Number.isFinite(x) ? x : 0;
  }
  return v;
}

/**
 * True when a row has every feature present and finite (used to drop warm-up
 * rows before training so we don't teach the model on padded zeros).
 */
export function rowIsComplete(row) {
  for (let i = 0; i < FEATURE_COUNT; i++) {
    const x = row[FEATURE_NAMES[i]];
    if (x === null || x === undefined || Number.isNaN(x)) return false;
  }
  return true;
}
