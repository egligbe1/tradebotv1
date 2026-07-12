/**
 * assetConfig.js — per-asset trading-cost model (browser + Node safe).
 *
 * A backtest that ignores spread, commission and slippage is fiction: for a
 * ~0.2% stop on EUR/USD the spread alone is a meaningful slice of the risk.
 * All costs are expressed as a FRACTION of price so they apply uniformly
 * across FX, metals and crypto. Values are conservative retail estimates —
 * tune them to your broker/exchange.
 */

const CLASS_DEFAULTS = {
  forex: { spread: 0.00008, slippage: 0.00004, commission: 0.00002, scaler: 'robust', pip: 0.0001, digits: 5 },
  jpy: { spread: 0.00006, slippage: 0.00004, commission: 0.00002, scaler: 'robust', pip: 0.01, digits: 3 },
  metal: { spread: 0.00015, slippage: 0.00010, commission: 0.00003, scaler: 'robust', pip: 0.01, digits: 2 },
  crypto: { spread: 0.00050, slippage: 0.00030, commission: 0.00010, scaler: 'robust', pip: 0.01, digits: 2 },
  stock: { spread: 0.00030, slippage: 0.00020, commission: 0.00010, scaler: 'robust', pip: 0.01, digits: 2 },
  index: { spread: 0.00020, slippage: 0.00015, commission: 0.00005, scaler: 'robust', pip: 0.1, digits: 2 },
};

// Explicit overrides where the class default digits aren't ideal.
const SYMBOL_MAP = {
  'EUR/USD': { class: 'forex' },
  'GBP/USD': { class: 'forex' },
  'USD/JPY': { class: 'jpy' },
  'XAU/USD': { class: 'metal' },
  'BTC/USD': { class: 'crypto', digits: 2 },
  'ETH/USD': { class: 'crypto', digits: 2 },
  'SOL/USD': { class: 'crypto', digits: 3 },
};

const CRYPTO_BASES = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'LTC', 'DOT', 'AVAX', 'LINK', 'MATIC', 'TRX']);
const METAL_BASES = new Set(['XAU', 'XAG', 'XPT', 'XPD']);
const STABLE_QUOTES = new Set(['USDT', 'USDC', 'DAI', 'BUSD']);
const INDEX_HINTS = new Set(['SPX', 'NDX', 'DJI', 'RUT', 'VIX', 'GSPC', 'IXIC', 'FTSE', 'DAX', 'N225']);

/**
 * Classify any symbol into an asset class from its shape, so the cost model,
 * price rounding and trading sessions work for arbitrary Twelve Data
 * instruments — not just the seven built-ins.
 */
export function classifySymbol(symbol) {
  if (!symbol) return 'forex';
  const s = symbol.toUpperCase();
  if (s.includes('/')) {
    const [base, quote] = s.split('/');
    if (METAL_BASES.has(base)) return 'metal';
    if (CRYPTO_BASES.has(base) || STABLE_QUOTES.has(quote)) return 'crypto';
    if (quote === 'JPY') return 'jpy';
    return 'forex';
  }
  const bare = s.replace('^', '');
  if (INDEX_HINTS.has(bare) || s.startsWith('^')) return 'index';
  return 'stock';
}

export function getAssetInfo(symbol) {
  const override = SYMBOL_MAP[symbol];
  const cls = override?.class || classifySymbol(symbol);
  const def = CLASS_DEFAULTS[cls] || CLASS_DEFAULTS.forex;
  return {
    class: cls,
    pip: override?.pip ?? def.pip,
    digits: override?.digits ?? def.digits,
  };
}

// ── Trading sessions (UTC) ──────────────────────────────────────────────────
// Used by the headless bot to avoid scanning dead/closed markets.
const SESSIONS = {
  forex: { days: [1, 2, 3, 4, 5], open: 0, close: 22 },   // FX ~24/5
  jpy: { days: [1, 2, 3, 4, 5], open: 0, close: 22 },
  metal: { days: [1, 2, 3, 4, 5], open: 1, close: 21 },
  crypto: { days: [0, 1, 2, 3, 4, 5, 6], open: 0, close: 24 }, // 24/7
  stock: { days: [1, 2, 3, 4, 5], open: 13.5, close: 20 }, // US RTH ≈ 13:30–20:00 UTC
  index: { days: [1, 2, 3, 4, 5], open: 13.5, close: 20 },
};

export function getSession(symbol) {
  return SESSIONS[classifySymbol(symbol)] || SESSIONS.forex;
}

/** Whether the market is plausibly open now (UTC). Crypto is always open. */
export function isMarketLikelyOpen(symbol, date = new Date()) {
  const sess = getSession(symbol);
  const day = date.getUTCDay();
  if (!sess.days.includes(day)) return false;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  return hour >= sess.open && hour < sess.close;
}

// Curated quick-picks spanning every class for the Settings search UI.
export const QUICK_PICKS = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'USD/CAD', 'NZD/USD', 'EUR/JPY', 'GBP/JPY',
  'XAU/USD', 'XAG/USD',
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD',
  'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN',
];

/**
 * Cost model for a symbol.
 * @returns {{spread:number, slippage:number, commission:number,
 *            roundTrip:number, scaler:string, pip:number, digits:number}}
 * roundTrip = total fraction of price lost across a full entry+exit cycle.
 */
export function getCostModel(symbol) {
  const info = getAssetInfo(symbol);
  const c = CLASS_DEFAULTS[info.class] || CLASS_DEFAULTS.forex;
  // Entry pays half-spread + slippage + commission; exit pays the same.
  const perSide = c.spread / 2 + c.slippage + c.commission;
  return {
    spread: c.spread,
    slippage: c.slippage,
    commission: c.commission,
    roundTrip: perSide * 2,
    scaler: c.scaler,
    pip: info.pip,
    digits: info.digits,
    assetClass: info.class,
  };
}

/** Number of decimal places to display prices for a symbol. */
export function priceDigits(symbol) {
  return getAssetInfo(symbol).digits;
}
