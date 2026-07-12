/**
 * server/cli.js — helper commands for the headless bot.
 *
 *   npm run bot:cli chatid   → discover your Telegram chat id (message the bot first)
 *   npm run bot:cli ping     → send a test Telegram message
 *   npm run bot:cli test     → train + scan ONE instrument once and print the signal
 */

import { config, assertConfig } from './config.js';
import { buildFeatures, trainSymbol, evaluateSymbol, sendTelegram } from './core.js';

const cmd = (process.argv[2] || '').toLowerCase();

async function chatid() {
  if (!config.telegramToken) { console.error('Set TELEGRAM_BOT_TOKEN first.'); process.exit(1); }
  const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/getUpdates`);
  const data = await res.json();
  const ids = new Set();
  for (const u of data.result || []) {
    const c = u.message?.chat || u.channel_post?.chat;
    if (c) ids.add(`${c.id} (${c.type}${c.title ? ` · ${c.title}` : ''}${c.username ? ` · @${c.username}` : ''})`);
  }
  if (ids.size === 0) console.log('No chats found. Send a message to your bot first, then rerun.');
  else { console.log('Chat IDs:'); ids.forEach((i) => console.log('  ' + i)); }
}

async function ping() {
  if (!config.telegramToken || !config.telegramChatId) { console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.'); process.exit(1); }
  await sendTelegram(config.telegramToken, config.telegramChatId, '🏓 TradeBot ping — connection OK.');
  console.log('Sent. Check Telegram.');
}

async function test() {
  assertConfig();
  let tf;
  try { tf = await import('@tensorflow/tfjs-node'); } catch { tf = await import('@tensorflow/tfjs'); }
  const symbol = config.symbols[0];
  console.log(`Training + scanning ${symbol}…`);
  const features = await buildFeatures(config.apiKey, symbol, config.historyBars);
  const bundle = await trainSymbol(tf, features, (m) => console.log(`  ${m}`));
  const sig = evaluateSymbol(tf, symbol, features, bundle);
  console.log('\nSignal:', JSON.stringify(sig, null, 2));
}

const commands = { chatid, ping, test };
if (!commands[cmd]) {
  console.log('Usage: npm run bot:cli <chatid|ping|test>');
  process.exit(1);
}
commands[cmd]().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
