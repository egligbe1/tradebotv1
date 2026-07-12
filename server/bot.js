/**
 * server/bot.js — 24/7 headless paper-trading bot.
 *
 * Reuses the exact verified core (features, calibrated skill-weighted ensemble,
 * per-asset costs) to poll each instrument, manage a paper ledger like an
 * experienced trader (risk sizing, TP1 partial + breakeven, TP2), and alert via
 * Telegram on new signals and closes. Retrains models on a schedule.
 *
 *   npm run bot
 */

import { config, assertConfig } from './config.js';
import { buildFeatures, trainSymbol, evaluateSymbol, sendTelegram } from './core.js';
import { loadLedger, saveLedger, manageTrades, hasOpenTrade, openTrade, ledgerStats } from './ledger.js';
import { isMarketLikelyOpen } from '../src/lib/assetConfig.js';
import { buildSignalMessage, isTelegramWindowOpen } from '../src/lib/signalMessage.js';

const alertWindowOpen = () => isTelegramWindowOpen(new Date(), config.telegramStartHourUtc, config.telegramEndHourUtc);

let tf;
try { tf = await import('@tensorflow/tfjs-node'); console.log('🚀 tfjs-node'); }
catch { tf = await import('@tensorflow/tfjs'); console.log('⚠️  tfjs (JS fallback — slower)'); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bundles = new Map();       // symbol → trained model bundle
const lastSignal = new Map();    // symbol → 'BUY'|'SELL'|'HOLD'
let lastRetrain = 0;

async function retrainAll() {
  console.log(`\n🧠 [${new Date().toISOString()}] Retraining ${config.symbols.length} instruments…`);
  for (const symbol of config.symbols) {
    try {
      const features = await buildFeatures(config.apiKey, symbol, config.historyBars);
      const bundle = await trainSymbol(tf, features, (m) => console.log(`   ${symbol}: ${m}`));
      bundles.set(symbol, bundle);
    } catch (e) {
      console.error(`   ${symbol}: train failed — ${e.message}`);
    }
    await sleep(config.callSpacingMs);
  }
  lastRetrain = Date.now();
  console.log('🧠 Retrain complete.');
}

async function scanOnce(ledger) {
  for (const symbol of config.symbols) {
    const bundle = bundles.get(symbol);
    if (!bundle) continue;
    if (!isMarketLikelyOpen(symbol)) continue; // skip closed markets
    try {
      const features = await buildFeatures(config.apiKey, symbol, 800);
      const row = features.at(-1);
      const nowIso = new Date().toISOString();

      // 1) Manage existing paper trades against the latest bar.
      const closeEvents = manageTrades(ledger, symbol, { high: row.high, low: row.low, close: row.close }, nowIso);
      for (const ev of closeEvents) {
        if (alertWindowOpen()) {
          await sendTelegram(config.telegramToken, config.telegramChatId,
            `📕 <b>${ev.symbol}</b> ${ev.reason} (${(ev.fraction * 100).toFixed(0)}%) — P&L ${ev.pnlPct >= 0 ? '+' : ''}${ev.pnlPct.toFixed(2)}%`);
        }
        console.log(`   💤 ${symbol} ${ev.reason} ${ev.pnlPct.toFixed(2)}%`);
      }

      // 2) Evaluate ensemble and open a new trade if flat & confident.
      const sig = evaluateSymbol(tf, symbol, features, bundle);
      const prev = lastSignal.get(symbol);
      lastSignal.set(symbol, sig.signal);

      if (sig.signal !== 'HOLD' && sig.confidence >= config.minConfidence && !hasOpenTrade(ledger, symbol)) {
        const t = openTrade(ledger, sig, config.riskPct, nowIso);
        if (t) {
          const arrow = sig.signal === 'BUY' ? '🟢' : '🔴';
          if (alertWindowOpen()) {
            await sendTelegram(config.telegramToken, config.telegramChatId, buildSignalMessage(symbol, {
              signal: sig.signal, confidence: sig.confidence, entry: sig.entry,
              stopLoss: sig.sl, tp1: sig.tp1, tp2: sig.tp2,
              modelsAligned: sig.modelsAligned, trendFilter: sig.trendFilter,
            }));
          }
          console.log(`   ${arrow} ${symbol} ${sig.signal} @${sig.entry} conf=${(sig.confidence * 100).toFixed(1)}%${alertWindowOpen() ? '' : ' (alert suppressed — outside GMT window)'}`);
        }
      } else if (sig.signal !== prev) {
        console.log(`   … ${symbol} ${sig.signal} (pUp=${sig.ensembleProbUp.toFixed(3)}, votes ${sig.votes.bull}/${sig.votes.bear})`);
      }
    } catch (e) {
      console.error(`   ${symbol}: scan failed — ${e.message}`);
    }
    await sleep(config.callSpacingMs);
  }
  saveLedger(config.ledgerFile, ledger);
  const s = ledgerStats(ledger);
  console.log(`📊 Balance $${s.balance.toFixed(2)} (${s.totalReturnPct >= 0 ? '+' : ''}${s.totalReturnPct.toFixed(2)}%) | open ${s.openCount} | closed ${s.closedCount} | win ${s.winRate.toFixed(1)}%`);
}

async function main() {
  assertConfig();
  console.log(`🤖 TradeBot paper trader — ${config.symbols.length} instruments, poll ${config.pollMinutes}m, retrain ${config.retrainHours}h`);
  const ledger = loadLedger(config.ledgerFile, config.initialBalance);
  await sendTelegram(config.telegramToken, config.telegramChatId, '🤖 TradeBot paper trader is online.');

  await retrainAll();

  for (;;) {
    if (Date.now() - lastRetrain > config.retrainHours * 3600 * 1000) await retrainAll();
    await scanOnce(ledger);
    console.log(`⏳ Sleeping ${config.pollMinutes}m…`);
    await sleep(config.pollMinutes * 60 * 1000);
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
