import { 
  rsi, 
  macd, 
  bollingerbands, 
  ema, 
  atr, 
  stochastic, 
  cci, 
  williamsr 
} from 'technicalindicators';

export class FeatureEngine {
  
  /**
   * Main entry point: Transform array of raw OHLCV candles into feature matrix
   * @param {Array} candles - Array of objects {datetime, open, high, low, close, volume} ordered oldest to newest
   * @returns {Array} Array of objects containing all computed features
   */
  static extractFeatures(candles) {
    if (!candles || candles.length < 200) {
      console.warn("FeatureEngine requires at least 200 candles for proper EMA200 calculation.");
    }

    // Ensure ascending chronological order for indicators
    const sorted = [...candles].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    
    // Arrays for technical indicators calculation
    const closePrices = sorted.map(c => c.close);
    const highPrices = sorted.map(c => c.high);
    const lowPrices = sorted.map(c => c.low);
    const volumes = sorted.map(c => c.volume);

    // Compute technical indicators
    const rsi14 = rsi({ period: 14, values: closePrices });
    const macdData = macd({
      values: closePrices,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    
    const bb = bollingerbands({ period: 20, stdDev: 2, values: closePrices });
    const ema9 = ema({ period: 9, values: closePrices });
    const ema21 = ema({ period: 21, values: closePrices });
    const ema50 = ema({ period: 50, values: closePrices });
    const ema200 = ema({ period: 200, values: closePrices });
    
    const atr14 = atr({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });
    const stochData = stochastic({ high: highPrices, low: lowPrices, close: closePrices, period: 14, signalPeriod: 3 });
    const cci20 = cci({ high: highPrices, low: lowPrices, close: closePrices, period: 20 });
    const wr14 = williamsr({ high: highPrices, low: lowPrices, close: closePrices, period: 14 });

    // Calculate rolling volume SMA (20 period) manually for the ratio
    const volSma20 = [];
    for (let i = 0; i < volumes.length; i++) {
        if (i < 19) {
            volSma20.push(null);
        } else {
            const sum = volumes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0);
            volSma20.push(sum / 20);
        }
    }

    // Build feature matrix
    const features = [];
    
    for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        const prevC = i > 0 ? sorted[i - 1] : null;

        const row = {
           datetime: c.datetime,
           open: c.open,
           high: c.high,
           low: c.low,
           close: c.close,
           volume: c.volume,
        };

        // Price-Derived Features
        row.log_return = prevC ? Math.log(c.close / prevC.close) : 0;
        const range = c.high - c.low;
        row.hl_range = range !== 0 ? range / c.close : 0;
        row.body_size = range !== 0 ? Math.abs(c.close - c.open) / range : 0;
        row.upper_wick = range !== 0 ? (c.high - Math.max(c.open, c.close)) / range : 0;
        row.lower_wick = range !== 0 ? (Math.min(c.open, c.close) - c.low) / range : 0;

        // Alignment helper: indicators return arrays shorter than input by `period - 1`
        // We pad the beginning with nulls so the index aligns with `sorted`
        const padAlign = (arr, period) => {
            const padCount = sorted.length - arr.length;
            if (i < padCount) return null;
            return arr[i - padCount];
        };

        // Indicator assignment
        row.rsi = padAlign(rsi14, 14);
        row.rsi_norm = row.rsi !== null ? row.rsi / 100 : null; // [0,1]
        
        const m = padAlign(macdData, 26); // MACD slow period determines start
        row.macd_line = m ? m.MACD : null;
        row.macd_signal = m ? m.signal : null;
        row.macd_hist = m ? m.histogram : null;

        const b = padAlign(bb, 20);
        if (b && b.upper - b.lower !== 0) {
            row.bb_pct_b = (c.close - b.lower) / (b.upper - b.lower);
            row.bb_width = (b.upper - b.lower) / b.middle;
        } else {
            row.bb_pct_b = null;
            row.bb_width = null;
        }

        row.ema9 = padAlign(ema9, 9);
        row.ema21 = padAlign(ema21, 21);
        row.ema50 = padAlign(ema50, 50);
        row.ema200 = padAlign(ema200, 200);

        // Trend Regime features (Distance to EMAs)
        row.trend_regime = row.ema200 ? (c.close - row.ema200) / row.ema200 : 0;
        row.trend_strength = (row.ema50 && row.ema200) ? (row.ema50 - row.ema200) / row.ema200 : 0;
        
        // Cross signals
        row.ema9_gt_21 = (row.ema9 && row.ema21) ? (row.ema9 > row.ema21 ? 1 : 0) : null;
        row.ema21_gt_50 = (row.ema21 && row.ema50) ? (row.ema21 > row.ema50 ? 1 : 0) : null;

        const a = padAlign(atr14, 14);
        row.atr = a;
        row.atr_norm = a ? a / c.close : null;

        const s = padAlign(stochData, 14);
        row.stoch_k = s ? s.k : null;
        row.stoch_d = s ? s.d : null;

        row.cci = padAlign(cci20, 20);
        row.williams_r = padAlign(wr14, 14);
        
        const safeVolSma = (volSma20[i] && volSma20[i] > 0) ? volSma20[i] : 1;
        row.vol_ratio = (c.volume || 0) / safeVolSma;
        if (Number.isNaN(row.vol_ratio)) row.vol_ratio = 1.0;

        // Time Features (Requires parsing datetime strings correctly based on interval)
        // Twelve Data 'datetime' format: "2026-03-09 15:00:00"
        const dt = new Date(c.datetime.replace(' ', 'T') + 'Z'); // Parse as UTC assuming API returns UTC/EST. TwelveData is EST by default unless specified.
        // Assuming we standardized API to UTC time in application or treat Twelve Data string natively
        const hour = dt.getUTCHours();
        const dow = dt.getUTCDay(); // 0(Sun) - 6(Sat)

        row.hour_sin = Math.sin(2 * Math.PI * hour / 24);
        row.hour_cos = Math.cos(2 * Math.PI * hour / 24);
        
        // Trading week is 5 days, shift dow to 0-4 (Mon-Fri) if we ignore weekend gaps
        let adjustedDow = dow - 1; 
        if (adjustedDow < 0) adjustedDow = 4; // Map Sunday to Friday for continuous calc
        row.dow_sin = Math.sin(2 * Math.PI * adjustedDow / 5);
        row.dow_cos = Math.cos(2 * Math.PI * adjustedDow / 5);

        row.is_london = (hour >= 7 && hour < 16) ? 1 : 0;
        row.is_ny = (hour >= 13 && hour < 22) ? 1 : 0;
        row.is_overlap = (hour >= 13 && hour < 16) ? 1 : 0;

        // Support & Resistance (Fractal Swing Point Detection)
        // A swing high = candle whose high is the highest of L neighbors on each side
        const SR_LOOKBACK = 5; 
        const SR_HISTORY  = 500; // Increased to ~3 weeks of H1 data for "enough data" 
        
        if (i >= SR_LOOKBACK + 1) {
            const scanStart = Math.max(0, i - SR_HISTORY);
            const pivotHighs = [];
            const pivotLows = [];
            
            for (let k = scanStart + SR_LOOKBACK; k <= i - SR_LOOKBACK; k++) {
                let isSwingHigh = true;
                let isSwingLow = true;
                const candidateHigh = sorted[k].high;
                const candidateLow = sorted[k].low;
                
                for (let n = 1; n <= SR_LOOKBACK; n++) {
                    if (sorted[k - n].high >= candidateHigh || sorted[k + n].high >= candidateHigh) isSwingHigh = false;
                    if (sorted[k - n].low <= candidateLow || sorted[k + n].low <= candidateLow) isSwingLow = false;
                }
                
                if (isSwingHigh) pivotHighs.push(candidateHigh);
                if (isSwingLow) pivotLows.push(candidateLow);
            }
            
            const clusterLevels = (pivots) => {
                if (pivots.length === 0) return [];
                const sorted_p = [...pivots].sort((a, b) => a - b);
                const zones = [];
                let cluster = [sorted_p[0]];
                
                for (let j = 1; j < sorted_p.length; j++) {
                    const tolerance = cluster[0] * 0.002; // 0.2% merge band for robust zones
                    if (Math.abs(sorted_p[j] - cluster[cluster.length - 1]) <= tolerance) {
                        cluster.push(sorted_p[j]);
                    } else {
                        const mid = cluster.reduce((a, b) => a + b, 0) / cluster.length;
                        zones.push({ 
                            price: mid, 
                            top: Math.max(...cluster),
                            bottom: Math.min(...cluster),
                            touches: cluster.length 
                        });
                        cluster = [sorted_p[j]];
                    }
                }
                const mid = cluster.reduce((a, b) => a + b, 0) / cluster.length;
                zones.push({ 
                    price: mid, 
                    top: Math.max(...cluster),
                    bottom: Math.min(...cluster),
                    touches: cluster.length 
                });
                return zones.sort((a, b) => b.touches - a.touches); // Strongest first
            };
            
            const resistanceZones = clusterLevels(pivotHighs).filter(z => z.price > c.close);
            const supportZones = clusterLevels(pivotLows).filter(z => z.price < c.close);
            
            // Promote only the single strongest level as requested
            row.support_50 = supportZones.length > 0 ? supportZones[0].price : null;
            row.resistance_50 = resistanceZones.length > 0 ? resistanceZones[0].price : null;
            row.support_zone = supportZones.length > 0 ? { top: supportZones[0].top, bottom: supportZones[0].bottom } : null;
            row.resistance_zone = resistanceZones.length > 0 ? { top: resistanceZones[0].top, bottom: resistanceZones[0].bottom } : null;
            
            row.support_touches = supportZones.length > 0 ? supportZones[0].touches : 0;
            row.resistance_touches = resistanceZones.length > 0 ? resistanceZones[0].touches : 0;
            
            row.dist_to_support = row.support_50 ? (c.close - row.support_50) / row.support_50 : null;
            row.dist_to_resistance = row.resistance_50 ? (row.resistance_50 - c.close) / row.resistance_50 : null;

            // --- Market Structure Detection (HH/HL/LH/LL) ---
            if (pivotHighs.length >= 2 && pivotLows.length >= 2) {
               const lastPH = pivotHighs[pivotHighs.length - 1];
               const prevPH = pivotHighs[pivotHighs.length - 2];
               const lastPL = pivotLows[pivotLows.length - 1];
               const prevPL = pivotLows[pivotLows.length - 2];

               row.ms_high = lastPH > prevPH ? 'HH' : 'LH';
               row.ms_low = lastPL > prevPL ? 'HL' : 'LL';
               
               // Trend state based on structure confluence
               if (row.ms_high === 'HH' && row.ms_low === 'HL') row.ms_structure = 'BULLISH';
               else if (row.ms_high === 'LH' && row.ms_low === 'LL') row.ms_structure = 'BEARISH';
               else row.ms_structure = 'CHOCH'; // Change of Character / Indecision
               
               // Numeric encoding for ML Models
               row.ms_structure_num = (row.ms_structure === 'BULLISH' ? 1 : (row.ms_structure === 'BEARISH' ? -1 : 0));
            } else {
               row.ms_high = null;
               row.ms_low = null;
               row.ms_structure = 'NEUTRAL';
               row.ms_structure_num = 0;
            }
        } else {
            row.support_50 = null;
            row.resistance_50 = null;
            row.support_zone = null;
            row.resistance_zone = null;
            row.dist_to_support = null;
            row.dist_to_resistance = null;
            row.support_touches = 0;
            row.resistance_touches = 0;
            row.ms_structure = 'INITIALIZING';
            row.ms_structure_num = 0;
        }

        // Pivot Points (Previous Candle Basis)
        if (prevC) {
            const pp = (prevC.high + prevC.low + prevC.close) / 3;
            row.pivot_point = pp;
            row.pivot_dist = (c.close - pp) / pp;
        } else {
            row.pivot_point = null;
            row.pivot_dist = null;
        }

        // Price Action Triggers
        row.trigger_engulfing = 0; 
        row.trigger_pinbar = 0;    
        row.trigger_doji = 0;
        row.trigger_inside_bar = 0;
        row.trigger_star = 0; // 1 = Morning Star (Bullish), -1 = Evening Star (Bearish)
        
        if (prevC) {
            const prevBody = Math.abs(prevC.close - prevC.open);
            const currBody = Math.abs(c.close - c.open);
            const totalRange = c.high - c.low;
            
            // 1. Engulfing
            if (currBody > prevBody) {
                if (c.close > c.open && prevC.close < prevC.open && c.close > prevC.open && c.open < prevC.close) {
                    row.trigger_engulfing = 1;
                } else if (c.close < c.open && prevC.close > prevC.open && c.close < prevC.open && c.open > prevC.close) {
                    row.trigger_engulfing = -1;
                }
            }
            
            // 2. Pin Bar (Long wick, small body)
            if (totalRange > 0 && currBody / totalRange < 0.3) {
                const upperWick = c.high - Math.max(c.open, c.close);
                const lowerWick = Math.min(c.open, c.close) - c.low;
                if (lowerWick > totalRange * 0.6) row.trigger_pinbar = 1;  
                else if (upperWick > totalRange * 0.6) row.trigger_pinbar = -1;
            }

            // 3. Doji (Indecision)
            if (totalRange > 0 && currBody / totalRange < 0.1) {
                row.trigger_doji = 1;
            }

            // 4. Inside Bar (Consolidation)
            if (c.high < prevC.high && c.low > prevC.low) {
                row.trigger_inside_bar = 1;
            }

            // 5. Morning / Evening Star (3-Candle Reversal)
            // Needs i >= 2
            if (i >= 2) {
                const twoBack = sorted[i-2];
                const twoBackBody = Math.abs(twoBack.close - twoBack.open);
                const prevRange = prevC.high - prevC.low;
                
                // Morning Star: Bearish(L) -> Small(S) -> Bullish(L)
                if (twoBack.close < twoBack.open &&                   // Large Bearish
                    prevBody / prevRange < 0.3 &&                    // Small prev body (Star)
                    c.close > c.open && c.close > twoBack.open + (twoBackBody * 0.5)) { // Strong Bullish reversal
                    row.trigger_star = 1;
                }
                // Evening Star: Bullish(L) -> Small(S) -> Bearish(L)
                else if (twoBack.close > twoBack.open &&               // Large Bullish
                         prevBody / prevRange < 0.3 &&                // Small prev body (Star)
                         c.close < c.open && c.close < twoBack.open - (twoBackBody * 0.5)) { // Strong Bearish reversal
                    row.trigger_star = -1;
                }
            }
        }

        features.push(row);
    }

    // Pass 2: Calculate Lag Features and Targets
    for (let i = 0; i < features.length; i++) {
        const row = features[i];
        
        // Lags
        row.return_lag1 = i >= 1 ? features[i-1].log_return : null;
        row.return_lag2 = i >= 2 ? features[i-2].log_return : null;
        row.return_lag3 = i >= 3 ? features[i-3].log_return : null;
        row.return_lag5 = i >= 5 ? features[i-5].log_return : null;
        
        row.rsi_lag1 = i >= 1 ? features[i-1].rsi_norm : null;
        row.rsi_lag3 = i >= 3 ? features[i-3].rsi_norm : null;
        
        row.macd_hist_lag1 = i >= 1 ? features[i-1].macd_hist : null;
        row.macd_hist_lag2 = i >= 2 ? features[i-2].macd_hist : null;

        // Targets (for historical training) - TRIPLE BARRIER METHOD
        const LOOKAHEAD = 24;
        const TP_PCT = 0.005; // 0.5% Take Profit 
        const SL_PCT = 0.002; // 0.2% Stop Loss 
        
        row.target_class = 0; // Default to HOLD/SELL
        
        if (i < features.length - 1) {
            const entryPrice = row.close;
            const upperBarrier = entryPrice * (1 + TP_PCT);
            const lowerBarrier = entryPrice * (1 - SL_PCT);
            
            for (let j = 1; j <= LOOKAHEAD; j++) {
                if (i + j >= features.length) break;
                const futureCandle = features[i + j];
                
                if (futureCandle.high >= upperBarrier && futureCandle.low <= lowerBarrier) {
                    row.target_class = 0; // Ambiguous/volatile crash, assume loss
                    break;
                } else if (futureCandle.high >= upperBarrier) {
                    row.target_class = 1; // Clean Win
                    break;
                } else if (futureCandle.low <= lowerBarrier) {
                    row.target_class = 0; // Loss
                    break;
                }
            }
        } else {
            row.target_class = null; // Cannot compute for the very active, unclosed hour
        }
        
        row.forward_return_1 = (i + 1 < features.length) ? (features[i+1].close - row.close) / row.close : null;
        row.forward_return_3 = (i + 3 < features.length) ? (features[i+3].close - row.close) / row.close : null;
    }

    return features;
  }

  /**
   * Enriches 1h features with a Macro Trend filter from 4h data
   * @param {Array} features - The 1h feature array
   * @param {Array} macroCandles - The 4h candles
   */
  static enrichWithMacroTrend(features, macroCandles) {
    if (!macroCandles || macroCandles.length < 200) return features;

    const macroCloses = macroCandles.map(c => c.close);
    const macroEma200 = ema({ period: 200, values: macroCloses });
    
    // Create a lookup for macro status by hour/date
    const macroMap = new Map();
    for (let i = 0; i < macroCandles.length; i++) {
        const c = macroCandles[i];
        const emaVal = i >= 199 ? macroEma200[i - 199] : null;
        if (emaVal) {
            macroMap.set(c.datetime, c.close > emaVal ? 1 : -1);
        }
    }

    // Align 1h features with the most recent 4h bucket
    for (const row of features) {
        // Find the nearest 4h bucket (Twelve Data 4h candles end on 0, 4, 8, 12, 16, 20)
        // Or we just find the largest macro datetime that is <= row.datetime
        let macroStatus = 0;
        let bestMacroDt = "";
        
        for (const mDt of macroMap.keys()) {
            if (mDt <= row.datetime && mDt > bestMacroDt) {
                bestMacroDt = mDt;
                macroStatus = macroMap.get(mDt);
            }
        }
        row.macro_trend = macroStatus;
    }
    return features;
  }
}
