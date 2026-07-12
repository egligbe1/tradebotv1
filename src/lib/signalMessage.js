/**
 * signalMessage.js — single source of truth for Telegram signal formatting
 * and the alerting time window. Shared by the browser (TelegramService), the
 * hourly CI sentinel, and the headless bot so every channel sends the same
 * message and honors the same schedule.
 */

export const MODEL_LABELS = {
  ruleEngine: 'Rule Engine',
  lstm: 'LSTM',
  randomForest: 'RF',
  logistic: 'Logistic Regression',
};

const MODEL_ORDER = ['ruleEngine', 'lstm', 'randomForest', 'logistic'];

/**
 * Friendly names of the models whose vote matched the master signal.
 * @param {object} votes  map like { ruleEngine:{signal}, lstm:{signal}, ... }
 * @param {string} masterSignal 'BUY' | 'SELL'
 */
export function alignedModelNames(votes, masterSignal) {
  if (!votes) return [];
  return MODEL_ORDER
    .filter((k) => votes[k] && votes[k].signal === masterSignal)
    .map((k) => MODEL_LABELS[k]);
}

/** Trend-filter caption based on alignment with the higher-timeframe 200 EMA. */
export function trendFilterText(aligned) {
  return aligned ? 'Aligned with Daily 200 EMA' : 'Counter-trend vs Daily 200 EMA';
}

/**
 * Telegram alerts are only sent inside this UTC/GMT window (default 08:00–15:00),
 * covering the London session and early New York overlap.
 */
export function isTelegramWindowOpen(date = new Date(), startHourUtc = 8, endHourUtc = 15) {
  const h = date.getUTCHours();
  return h >= startHourUtc && h < endHourUtc;
}

/**
 * Build the HTML Telegram message.
 * @param {string} symbol
 * @param {{signal, confidence, entry, stopLoss, tp1, tp2, modelsAligned?:string[], trendFilter?:string}} sig
 */
export function buildSignalMessage(symbol, sig) {
  const action = sig.signal === 'BUY' ? '🟢 BUY' : '🔴 SELL';
  const conf = (sig.confidence * 100).toFixed(1);
  const aligned = sig.modelsAligned && sig.modelsAligned.length ? sig.modelsAligned.join(', ') : '—';
  const trend = sig.trendFilter || '—';
  return [
    '<b>🚨 TRADEBOT SIGNAL 🚨</b>',
    `<b>Asset:</b> ${symbol}`,
    `<b>Action:</b> ${action}`,
    `<b>Conviction:</b> ${conf}%`,
    '',
    `<b>Entry:</b> ${sig.entry}`,
    `<b>Stop Loss:</b> ${sig.stopLoss}`,
    `<b>Take Profit 1:</b> ${sig.tp1}`,
    `<b>Take Profit 2:</b> ${sig.tp2}`,
    '',
    `<i>Models Aligned: ${aligned}</i>`,
    `<i>Trend Filter: ${trend}</i>`,
  ].join('\n');
}
