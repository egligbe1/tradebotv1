/**
 * scaler.js — feature standardization utilities (browser + Node safe).
 *
 * Neural nets and gradient-descent logistic regression are extremely sensitive
 * to input scale. Features here range from ~1e-4 (log_return) to hundreds
 * (cci, williams_r), so an unscaled network is dominated by whichever feature
 * happens to be largest. We fit a scaler on the TRAINING SLICE ONLY and persist
 * it alongside the weights, then apply the identical transform at inference.
 * Fitting on the whole series (or refitting at inference) is data leakage.
 *
 * RobustScaler (median / IQR) is used because financial features are heavy
 * tailed; a few volatility spikes would otherwise blow out a mean/std scaler.
 */

function quantileSorted(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sorted.length) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Fit a robust scaler on a 2D array of rows (each row = feature vector).
 * @param {number[][]} X
 * @returns {{center:number[], scale:number[]}}
 */
export function fitScaler(X) {
  if (!X.length) return { center: [], scale: [] };
  const nCols = X[0].length;
  const center = new Array(nCols);
  const scale = new Array(nCols);

  for (let c = 0; c < nCols; c++) {
    const col = new Array(X.length);
    for (let r = 0; r < X.length; r++) {
      const v = X[r][c];
      col[r] = Number.isFinite(v) ? v : 0;
    }
    col.sort((a, b) => a - b);
    const median = quantileSorted(col, 0.5);
    const iqr = quantileSorted(col, 0.75) - quantileSorted(col, 0.25);
    center[c] = median;
    // Guard against zero-variance columns (e.g. a flag that's constant on the
    // training slice) so we never divide by zero.
    scale[c] = iqr > 1e-9 ? iqr : 1;
  }
  return { center, scale };
}

/** Apply a fitted scaler to one feature vector. Returns a new array. */
export function applyScaler(vec, scaler) {
  if (!scaler || !scaler.center || scaler.center.length !== vec.length) {
    // No scaler (or shape mismatch) → pass through unchanged rather than crash.
    return vec.slice();
  }
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = (vec[i] - scaler.center[i]) / scaler.scale[i];
  }
  return out;
}

/** Apply a fitted scaler to a 2D array of vectors. */
export function applyScalerMatrix(X, scaler) {
  return X.map((row) => applyScaler(row, scaler));
}
