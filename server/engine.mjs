import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'ledger.json');

const HL_URL = process.env.HL_API_URL || 'https://api.hyperliquid.xyz/info';
const POLY_URL =
  process.env.POLY_API_URL ||
  'https://gamma-api.polymarket.com/markets?limit=12&active=true&closed=false&order=volume24hr&ascending=false';

const DEFAULT_LEDGER = () => ({
  mode: 'paper-live-prices',
  cashUsd: 1000,
  startingCashUsd: 1000,
  positions: [],
  bets: [],
  orders: [],
  pendingDraft: null,
  telegramBridge: {
    enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    alertsSent: 0,
    lastAlert: null,
  },
  updatedAt: new Date().toISOString(),
});

export function loadLedger(filePath = STATE_FILE) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    // Fall back to fresh ledger if corrupted
  }
  return DEFAULT_LEDGER();
}

export function saveLedger(ledger, filePath = STATE_FILE) {
  ledger.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(ledger, null, 2), 'utf8');
  return ledger;
}

export function parseHyperliquid(payload, topN = 8) {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  const universe = payload[0]?.universe ?? [];
  const ctxs = Array.isArray(payload[1]) ? payload[1] : [];
  const rows = [];
  for (let i = 0; i < Math.min(universe.length, ctxs.length); i += 1) {
    const symbol = String(universe[i]?.name ?? '');
    const ctx = ctxs[i] ?? {};
    const mark = Number(ctx.markPx);
    const oracle = Number(ctx.oraclePx || mark);
    const prev = Number(ctx.prevDayPx);
    const funding = Number(ctx.funding);
    const oiCoins = Number(ctx.openInterest);
    if (!symbol || !Number.isFinite(mark) || !Number.isFinite(funding)) continue;
    rows.push({
      symbol,
      markPrice: mark,
      change24hPct: Number.isFinite(prev) && prev > 0 ? ((mark - prev) / prev) * 100 : null,
      fundingAprPct: funding * 24 * 365 * 100,
      openInterestUsd: Number.isFinite(oiCoins) && Number.isFinite(oracle) ? oiCoins * oracle : 0,
    });
  }
  // Always keep BTC, ETH, SOL at the front if present, then top funding movers
  const coreOrder = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP'];
  const core = coreOrder
    .map((sym) => rows.find((r) => r.symbol === sym))
    .filter(Boolean);
  const rest = rows
    .filter((r) => !coreOrder.includes(r.symbol))
    .sort((a, b) => Math.abs(b.fundingAprPct) - Math.abs(a.fundingAprPct));
  return [...core, ...rest].slice(0, topN);
}

export function parsePolymarket(payload, topN = 6) {
  if (!Array.isArray(payload)) return [];
  const out = [];
  for (const m of payload) {
    if (!m || typeof m !== 'object') continue;
    const question = String(m.question ?? '').trim();
    if (!question) continue;
    let prices = [];
    if (typeof m.outcomePrices === 'string') {
      try {
        prices = JSON.parse(m.outcomePrices);
      } catch {
        prices = [];
      }
    } else if (Array.isArray(m.outcomePrices)) {
      prices = m.outcomePrices;
    }
    const yesRaw = Number(prices[0]);
    const noRaw = Number(prices[1] ?? (Number.isFinite(yesRaw) ? 1 - yesRaw : NaN));
    if (!Number.isFinite(yesRaw)) continue;
    out.push({
      id: String(m.id ?? m.slug ?? out.length),
      question,
      yesPct: Math.round(yesRaw * 1000) / 10,
      noPct: Math.round((Number.isFinite(noRaw) ? noRaw : 1 - yesRaw) * 1000) / 10,
      volume24hUsd: Number.isFinite(Number(m.volume24hr)) ? Number(m.volume24hr) : 0,
    });
    if (out.length >= topN) break;
  }
  return out;
}

export async function fetchMarkets(fetchImpl = fetch) {
  const [hlRes, polyRes] = await Promise.allSettled([
    fetchImpl(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    }).then((r) => {
      if (!r.ok) throw new Error(`HL HTTP ${r.status}`);
      return r.json();
    }),
    fetchImpl(POLY_URL).then((r) => {
      if (!r.ok) throw new Error(`Poly HTTP ${r.status}`);
      return r.json();
    }),
  ]);

  const perps = hlRes.status === 'fulfilled' ? parseHyperliquid(hlRes.value, 8) : [];
  const predictions = polyRes.status === 'fulfilled' ? parsePolymarket(polyRes.value, 6) : [];
  return {
    perps,
    predictions,
    fetchedAt: new Date().toISOString(),
    sourceStatus: `HL:${hlRes.status === 'fulfilled' ? perps.length : 'ERR'} POLY:${polyRes.status === 'fulfilled' ? predictions.length : 'ERR'}`,
  };
}

/**
 * Parse a concise voice command spoken into G2 microphone (after STT or text fallback)
 * into a structured action draft that MUST be confirmed with a tap before execution.
 */
export function parseVoiceIntent(rawText, markets, activeContext = {}) {
  const text = String(rawText || '').trim().toLowerCase();
  if (!text) return { error: 'Empty voice command' };

  if (/\b(close|flatten|exit)\s+(all|everything|positions?)\b/.test(text)) {
    return {
      id: crypto.randomUUID().slice(0, 8),
      kind: 'close_all',
      summary: 'CLOSE ALL open paper positions at live mark',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    };
  }

  // Prediction market bet: "bet 25 yes" / "bet 50 no"
  const betMatch = text.match(/\b(?:bet|buy|back)\s+\$?(\d+(?:\.\d+)?)\s+(yes|no)\b/);
  if (betMatch) {
    const amountUsd = Math.min(250, Math.max(5, Number(betMatch[1])));
    const outcome = betMatch[2].toUpperCase();
    const idx = Number.isInteger(activeContext.polyIndex) ? activeContext.polyIndex : 0;
    const market = markets.predictions[idx % Math.max(1, markets.predictions.length)];
    if (!market) return { error: 'No live Polymarket market loaded' };
    const price = (outcome === 'YES' ? market.yesPct : market.noPct) / 100;
    return {
      id: crypto.randomUUID().slice(0, 8),
      kind: 'poly_bet',
      marketId: market.id,
      question: market.question,
      outcome,
      amountUsd,
      entryProb: price,
      summary: `POLY ${outcome} $${amountUsd} @ ${(price * 100).toFixed(1)}%`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    };
  }

  // Perp trade: "buy 100 btc" / "long 50 eth" / "short 100 sol" / "sell 75"
  const perpMatch = text.match(/\b(buy|long|sell|short)\s+\$?(\d+(?:\.\d+)?)(?:\s+([a-z0-9]+))?\b/);
  if (perpMatch) {
    const side = perpMatch[1] === 'buy' || perpMatch[1] === 'long' ? 'LONG' : 'SHORT';
    const notionalUsd = Math.min(500, Math.max(10, Number(perpMatch[2])));
    const requestedSym = perpMatch[3] ? perpMatch[3].toUpperCase() : null;
    let perp = requestedSym
      ? markets.perps.find((p) => p.symbol.toUpperCase() === requestedSym)
      : markets.perps[(activeContext.perpIndex || 0) % Math.max(1, markets.perps.length)];
    if (!perp) return { error: `Symbol ${requestedSym || '(none)'} not found in live Hyperliquid feed` };
    const stopPct = 0.02;
    const stopPrice = side === 'LONG' ? perp.markPrice * (1 - stopPct) : perp.markPrice * (1 + stopPct);
    return {
      id: crypto.randomUUID().slice(0, 8),
      kind: 'hl_order',
      symbol: perp.symbol,
      side,
      notionalUsd,
      entryPrice: perp.markPrice,
      stopPrice,
      leverage: 2,
      summary: `HL ${side} ${perp.symbol} $${notionalUsd} @ $${perp.markPrice.toFixed(perp.markPrice >= 100 ? 1 : 3)} (SL 2%)`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    };
  }

  return {
    error: `Unrecognized command "${rawText}". Try: "long 100 btc", "short 50 eth", "bet 25 yes", "close all".`,
  };
}

export function computePortfolio(ledger, markets) {
  const priceMap = new Map(markets.perps.map((p) => [p.symbol, p.markPrice]));
  const polyMap = new Map(markets.predictions.map((m) => [m.id, m]));

  let unrealizedUsd = 0;
  let marginUsedUsd = 0;

  const positions = ledger.positions.map((pos) => {
    const mark = priceMap.get(pos.symbol) ?? pos.entryPrice;
    const dir = pos.side === 'LONG' ? 1 : -1;
    const pnlUsd = ((mark - pos.entryPrice) / pos.entryPrice) * pos.notionalUsd * dir;
    const margin = pos.notionalUsd / (pos.leverage || 2);
    unrealizedUsd += pnlUsd;
    marginUsedUsd += margin;
    return { ...pos, markPrice: mark, pnlUsd: Number(pnlUsd.toFixed(2)) };
  });

  const bets = ledger.bets.map((b) => {
    const m = polyMap.get(b.marketId);
    const curProb = m ? (b.outcome === 'YES' ? m.yesPct : m.noPct) / 100 : b.entryProb;
    const shares = b.amountUsd / Math.max(0.01, b.entryProb);
    const markValue = shares * curProb;
    const pnlUsd = markValue - b.amountUsd;
    unrealizedUsd += pnlUsd;
    return { ...b, curProb, pnlUsd: Number(pnlUsd.toFixed(2)) };
  });

  const equityUsd = Number((ledger.cashUsd + marginUsedUsd + unrealizedUsd).toFixed(2));
  const totalPnlUsd = Number((equityUsd - ledger.startingCashUsd).toFixed(2));

  return {
    mode: ledger.mode,
    cashUsd: Number(ledger.cashUsd.toFixed(2)),
    equityUsd,
    unrealizedUsd: Number(unrealizedUsd.toFixed(2)),
    totalPnlUsd,
    positions,
    bets,
    pendingDraft: ledger.pendingDraft,
    orderCount: ledger.orders.length,
    lastOrder: ledger.orders[ledger.orders.length - 1] || null,
    telegramBridge: ledger.telegramBridge,
  };
}

export function executeConfirmedDraft(ledger, markets) {
  const draft = ledger.pendingDraft;
  if (!draft) return { error: 'No pending draft to confirm' };
  if (Date.now() > Date.parse(draft.expiresAt)) {
    ledger.pendingDraft = null;
    return { error: 'Draft expired — re-issue voice or quick draft' };
  }

  const priceMap = new Map(markets.perps.map((p) => [p.symbol, p.markPrice]));
  const executedAt = new Date().toISOString();

  if (draft.kind === 'hl_order') {
    const mark = priceMap.get(draft.symbol) ?? draft.entryPrice;
    const margin = draft.notionalUsd / (draft.leverage || 2);
    if (margin > ledger.cashUsd) {
      return { error: `Insufficient paper cash ($${ledger.cashUsd.toFixed(2)} < $${margin.toFixed(2)} margin)` };
    }
    ledger.cashUsd = Number((ledger.cashUsd - margin).toFixed(2));
    const pos = {
      id: draft.id,
      symbol: draft.symbol,
      side: draft.side,
      notionalUsd: draft.notionalUsd,
      leverage: draft.leverage || 2,
      entryPrice: mark,
      stopPrice: draft.stopPrice,
      openedAt: executedAt,
    };
    ledger.positions.push(pos);
    const receipt = { ...draft, fillPrice: mark, status: 'FILLED_PAPER', executedAt };
    ledger.orders.push(receipt);
    ledger.pendingDraft = null;
    return { ok: true, receipt };
  }

  if (draft.kind === 'poly_bet') {
    if (draft.amountUsd > ledger.cashUsd) {
      return { error: `Insufficient paper cash ($${ledger.cashUsd.toFixed(2)} < $${draft.amountUsd})` };
    }
    ledger.cashUsd = Number((ledger.cashUsd - draft.amountUsd).toFixed(2));
    const bet = {
      id: draft.id,
      marketId: draft.marketId,
      question: draft.question,
      outcome: draft.outcome,
      amountUsd: draft.amountUsd,
      entryProb: draft.entryProb,
      openedAt: executedAt,
    };
    ledger.bets.push(bet);
    const receipt = { ...draft, status: 'FILLED_PAPER', executedAt };
    ledger.orders.push(receipt);
    ledger.pendingDraft = null;
    return { ok: true, receipt };
  }

  if (draft.kind === 'close_all') {
    let realized = 0;
    for (const pos of ledger.positions) {
      const mark = priceMap.get(pos.symbol) ?? pos.entryPrice;
      const dir = pos.side === 'LONG' ? 1 : -1;
      const pnl = ((mark - pos.entryPrice) / pos.entryPrice) * pos.notionalUsd * dir;
      const margin = pos.notionalUsd / (pos.leverage || 2);
      ledger.cashUsd = Number((ledger.cashUsd + margin + pnl).toFixed(2));
      realized += pnl;
    }
    const closedCount = ledger.positions.length;
    ledger.positions = [];
    const receipt = {
      ...draft,
      closedCount,
      realizedUsd: Number(realized.toFixed(2)),
      status: 'CLOSED_PAPER',
      executedAt,
    };
    ledger.orders.push(receipt);
    ledger.pendingDraft = null;
    return { ok: true, receipt };
  }

  return { error: `Unknown draft kind: ${draft.kind}` };
}

export async function maybeSendTelegramAlert(ledger, message, fetchImpl = fetch) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    ledger.telegramBridge.lastAlert = { sent: false, reason: 'env_not_configured', message };
    return false;
  }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `[G2 GlanceDesk] ${message}` }),
    });
    ledger.telegramBridge.alertsSent += res.ok ? 1 : 0;
    ledger.telegramBridge.lastAlert = { sent: res.ok, status: res.status, message, at: new Date().toISOString() };
    return res.ok;
  } catch (e) {
    ledger.telegramBridge.lastAlert = { sent: false, reason: String(e), message };
    return false;
  }
}
