/**
 * ensemble.js — skill-weighted, calibration-aware probability fusion.
 *
 * Instead of a fixed weighted vote, each model contributes its CALIBRATED P(up)
 * weighted by how much genuine out-of-sample skill it demonstrated (Brier skill
 * score on the validation slice) times any user-set preference weight. A model
 * no better than the base rate gets ~0 weight, so a confidently-wrong model
 * can't drag the ensemble around.
 */

/**
 * Brier skill score vs. the base-rate forecast. 1 = perfect, 0 = no better than
 * always predicting the mean, <0 = worse than base rate (clamped to 0 as weight).
 * @param {number[]} p predicted P(up)
 * @param {number[]} y outcomes (0/1)
 */
export function brierSkill(p, y) {
  const n = y.length;
  if (n === 0) return 0;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  let brier = 0;
  let base = 0;
  for (let i = 0; i < n; i++) {
    brier += (p[i] - y[i]) ** 2;
    base += (ybar - y[i]) ** 2;
  }
  brier /= n;
  base /= n;
  if (base <= 1e-9) return 0;
  return 1 - brier / base;
}

/**
 * Fuse per-model calibrated probabilities.
 * @param {Array<{key:string, p:number, skill?:number, userWeight?:number}>} entries
 * @returns {{pEns:number, weights:object}} ensemble P(up) and effective weights
 */
export function fuseCalibrated(entries) {
  let wsum = 0;
  let acc = 0;
  const weights = {};
  for (const e of entries) {
    // Effective weight = demonstrated skill × user preference. Floor skill at a
    // small value so a freshly-trained model without a skill score still counts.
    const skill = e.skill == null ? 0.25 : Math.max(0, e.skill);
    const user = e.userWeight == null ? 1 : e.userWeight;
    const w = skill * user;
    weights[e.key] = w;
    acc += w * (e.p ?? 0.5);
    wsum += w;
  }
  // If nothing has any weight, fall back to a plain average so we never divide
  // by zero or silently emit 0.5 when models actually disagree.
  if (wsum <= 1e-9) {
    const mean = entries.length ? entries.reduce((a, e) => a + (e.p ?? 0.5), 0) / entries.length : 0.5;
    return { pEns: mean, weights };
  }
  return { pEns: acc / wsum, weights };
}
