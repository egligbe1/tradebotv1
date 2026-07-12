/**
 * calibration.js — probability calibration (Platt scaling + isotonic).
 *
 * A model's raw output (softmax P(up), RF vote share, logistic score) is rarely
 * a true probability: a model that says "0.9" might only be right 60% of the
 * time. Calibration maps raw scores → empirical hit-rate using a held-out
 * validation slice, so the ensemble can trust confidence numbers and a
 * genuinely 90%-sure model outweighs a coin-flip.
 *
 *   • Platt  — 1-D logistic on the score's logit; robust with few samples.
 *   • Isotonic — non-decreasing step fit (Pool Adjacent Violators); more
 *     flexible, preferred once enough validation points exist.
 *
 * All calibrators serialize to plain JSON so they persist with the weights.
 */

const EPS = 1e-6;
const clip = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const logit = (p) => Math.log(clip(p) / (1 - clip(p)));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Fit Platt scaling: calibrated = sigmoid(a·logit(score) + b). */
export function fitPlatt(scores, y, opts = {}) {
  const { epochs = 500, lr = 0.05 } = opts;
  const n = scores.length;
  const x = scores.map(logit);
  let a = 1;
  let b = 0;
  for (let e = 0; e < epochs; e++) {
    let ga = 0;
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a * x[i] + b);
      const err = p - y[i];
      ga += err * x[i];
      gb += err;
    }
    a -= lr * ga / n;
    b -= lr * gb / n;
  }
  return { type: 'platt', a, b };
}

/** Fit isotonic regression via Pool Adjacent Violators. */
export function fitIsotonic(scores, y) {
  const pairs = scores.map((s, i) => ({ s, y: y[i] })).sort((p, q) => p.s - q.s);
  // Blocks of {sumY, count, value, xLo, xHi}
  const blocks = pairs.map((p) => ({ sum: p.y, cnt: 1, val: p.y, xLo: p.s, xHi: p.s }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].val <= blocks[i + 1].val) { i++; continue; }
    // Pool violating adjacent blocks
    const merged = {
      sum: blocks[i].sum + blocks[i + 1].sum,
      cnt: blocks[i].cnt + blocks[i + 1].cnt,
      xLo: blocks[i].xLo,
      xHi: blocks[i + 1].xHi,
    };
    merged.val = merged.sum / merged.cnt;
    blocks.splice(i, 2, merged);
    if (i > 0) i--;
  }
  const x = blocks.map((bk) => (bk.xLo + bk.xHi) / 2);
  const v = blocks.map((bk) => bk.val);
  return { type: 'isotonic', x, v };
}

function applyIsotonic(cal, p) {
  const { x, v } = cal;
  if (!x.length) return p;
  if (p <= x[0]) return v[0];
  if (p >= x[x.length - 1]) return v[v.length - 1];
  // linear interpolation between the two nearest breakpoints
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= p) lo = mid; else hi = mid;
  }
  const t = (p - x[lo]) / (x[hi] - x[lo] || 1);
  return v[lo] + t * (v[hi] - v[lo]);
}

/** Choose a method automatically: isotonic when data is plentiful, else Platt. */
export function fitCalibrator(scores, y) {
  if (!scores || scores.length < 30) return { type: 'identity' };
  if (scores.length >= 200) return fitIsotonic(scores, y);
  return fitPlatt(scores, y);
}

/** Apply any calibrator to a raw probability. */
export function calibrate(cal, p) {
  if (!cal || cal.type === 'identity') return p;
  if (cal.type === 'platt') return sigmoid(cal.a * logit(p) + cal.b);
  if (cal.type === 'isotonic') return applyIsotonic(cal, p);
  return p;
}
