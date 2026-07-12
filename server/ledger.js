/**
 * server/ledger.js — file-based paper-trading ledger.
 *
 * Simulates how an experienced trader actually manages a position:
 *   • risk-based sizing (fixed % of equity risked to the initial stop),
 *   • bank half at TP1 and move the stop to breakeven,
 *   • let the runner reach TP2 or get stopped at breakeven,
 *   • every closed leg pays realistic per-asset round-trip cost.
 */

import fs from 'fs';
import path from 'path';
import { getCostModel } from '../src/lib/assetConfig.js';

export function loadLedger(file, initialBalance = 10000) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* corrupt file → reinit */ }
  return { initialBalance, balance: initialBalance, open: [], closed: [], updatedAt: null };
}

export function saveLedger(file, ledger) {
  ledger.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, file); // atomic replace
}

export function hasOpenTrade(ledger, symbol) {
  return ledger.open.some((t) => t.symbol === symbol);
}

export function openTrade(ledger, sig, riskPct, nowIso) {
  const stopDistFrac = Math.abs(sig.entry - sig.sl) / sig.entry;
  if (!(stopDistFrac > 0)) return null;
  const dollarRisk = ledger.balance * riskPct;
  const size = dollarRisk / stopDistFrac; // notional so that a full stop ≈ dollarRisk
  const trade = {
    id: `${sig.symbol}-${nowIso}`,
    symbol: sig.symbol,
    side: sig.signal,
    entry: sig.entry,
    slInit: sig.sl,
    sl: sig.sl,
    tp1: sig.tp1,
    tp2: sig.tp2,
    size,
    remaining: 1,
    tp1Hit: false,
    realizedCash: 0,
    openedAt: nowIso,
    confidence: sig.confidence,
  };
  ledger.open.push(trade);
  return trade;
}

function closeLeg(ledger, t, fraction, exitPrice, reason, cost, nowIso, closedEvents) {
  const grossPct = t.side === 'BUY'
    ? (exitPrice - t.entry) / t.entry
    : (t.entry - exitPrice) / t.entry;
  const netPct = grossPct - cost.roundTrip;
  const cash = t.size * fraction * netPct;
  t.realizedCash += cash;
  t.remaining = Math.max(0, t.remaining - fraction);
  ledger.balance += cash;
  closedEvents.push({ symbol: t.symbol, side: t.side, reason, exitPrice, pnlPct: netPct * 100, pnlCash: cash, fraction });
  if (t.remaining <= 1e-9) {
    ledger.closed.push({
      ...t, exit: exitPrice, exitReason: reason, pnlCash: t.realizedCash,
      pnlPct: (t.realizedCash / (t.size || 1)) * 100, closedAt: nowIso,
    });
  }
}

/**
 * Advance all open trades for `symbol` against one bar {high, low, close}.
 * Returns an array of close events (for alerting).
 */
export function manageTrades(ledger, symbol, bar, nowIso) {
  const cost = getCostModel(symbol);
  const events = [];
  const survivors = [];

  for (const t of ledger.open) {
    if (t.symbol !== symbol) { survivors.push(t); continue; }
    const buy = t.side === 'BUY';
    const hitStop = buy ? bar.low <= t.sl : bar.high >= t.sl;
    const hitTP1 = buy ? bar.high >= t.tp1 : bar.low <= t.tp1;
    const hitTP2 = buy ? bar.high >= t.tp2 : bar.low <= t.tp2;

    // Conservative ordering: an untouched stop resolves before targets.
    if (!t.tp1Hit && hitStop) {
      closeLeg(ledger, t, t.remaining, t.sl, 'SL', cost, nowIso, events);
      continue;
    }
    if (!t.tp1Hit && hitTP1) {
      closeLeg(ledger, t, 0.5, t.tp1, 'TP1', cost, nowIso, events); // bank half
      t.tp1Hit = true;
      t.sl = t.entry; // move stop to breakeven
    }
    if (t.remaining > 1e-9 && hitTP2) {
      closeLeg(ledger, t, t.remaining, t.tp2, 'TP2', cost, nowIso, events);
      continue;
    }
    if (t.tp1Hit && t.remaining > 1e-9) {
      const hitBreakeven = buy ? bar.low <= t.sl : bar.high >= t.sl;
      if (hitBreakeven) {
        closeLeg(ledger, t, t.remaining, t.sl, 'BREAKEVEN', cost, nowIso, events);
        continue;
      }
    }
    survivors.push(t);
  }

  ledger.open = survivors;
  return events;
}

export function ledgerStats(ledger) {
  const closed = ledger.closed;
  const wins = closed.filter((t) => t.pnlCash > 0).length;
  return {
    balance: ledger.balance,
    totalReturnPct: ((ledger.balance - ledger.initialBalance) / ledger.initialBalance) * 100,
    openCount: ledger.open.length,
    closedCount: closed.length,
    winRate: closed.length ? (wins / closed.length) * 100 : 0,
  };
}
