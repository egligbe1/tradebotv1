/**
 * server/config.js — headless bot configuration from environment variables.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  apiKey: process.env.TWELVE_DATA_API_KEY || process.env.VITE_TWELVE_DATA_API_KEY || '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || process.env.VITE_TELEGRAM_CHAT_ID || '',

  symbols: (process.env.BOT_SYMBOLS || 'EUR/USD,GBP/USD,USD/JPY,XAU/USD,BTC/USD,ETH/USD,SOL/USD')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),

  pollMinutes: num(process.env.BOT_POLL_MINUTES, 15),
  retrainHours: num(process.env.BOT_RETRAIN_HOURS, 8),
  riskPct: num(process.env.BOT_RISK_PCT, 0.01),
  initialBalance: num(process.env.BOT_BALANCE, 10000),
  minConfidence: num(process.env.BOT_MIN_CONFIDENCE, 0.12),
  historyBars: num(process.env.BOT_HISTORY_BARS, 3000),
  callSpacingMs: num(process.env.BOT_CALL_SPACING_MS, 8000),

  // Telegram alerts only fire inside this UTC/GMT window (London + early NY).
  telegramStartHourUtc: num(process.env.TELEGRAM_START_HOUR_UTC, 8),
  telegramEndHourUtc: num(process.env.TELEGRAM_END_HOUR_UTC, 15),

  ledgerFile: process.env.BOT_LEDGER || path.join(__dirname, 'data', 'ledger.json'),
};

export function assertConfig() {
  if (!config.apiKey) {
    console.error('❌ Missing TWELVE_DATA_API_KEY (or VITE_TWELVE_DATA_API_KEY) in environment/.env');
    process.exit(1);
  }
}
