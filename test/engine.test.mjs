import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHyperliquid,
  parsePolymarket,
  parseVoiceIntent,
  executeConfirmedDraft,
  computePortfolio,
} from '../server/engine.mjs';

const sampleMarkets = {
  perps: parseHyperliquid([
    { universe: [{ name: 'BTC' }, { name: 'ETH' }, { name: 'SOL' }] },
    [
      { markPx: '95000', oraclePx: '95000', prevDayPx: '92000', funding: '0.00012', openInterest: '1200' },
      { markPx: '3200', oraclePx: '3200', prevDayPx: '3100', funding: '0.00008', openInterest: '5000' },
      { markPx: '210', oraclePx: '210', prevDayPx: '200', funding: '0.00025', openInterest: '100000' },
    ],
  ]),
  predictions: parsePolymarket([
    { id: 'm1', question: 'Will BTC exceed $100k this week?', outcomePrices: '["0.62","0.38"]', volume24hr: '1250000' },
  ]),
};

function freshLedger() {
  return {
    mode: 'paper-live-prices',
    cashUsd: 1000,
    startingCashUsd: 1000,
    positions: [],
    bets: [],
    orders: [],
    pendingDraft: null,
    telegramBridge: { enabled: false, alertsSent: 0, lastAlert: null },
  };
}

test('parses live-shaped Hyperliquid and Polymarket payloads', () => {
  assert.equal(sampleMarkets.perps.length, 3);
  assert.equal(sampleMarkets.perps[0].symbol, 'BTC');
  assert.equal(sampleMarkets.predictions[0].yesPct, 62);
});

test('voice intent drafts a bounded Hyperliquid perp order and one-tap confirm fills it', () => {
  const ledger = freshLedger();
  const draft = parseVoiceIntent('long 100 btc', sampleMarkets);
  assert.equal(draft.kind, 'hl_order');
  assert.equal(draft.symbol, 'BTC');
  assert.equal(draft.side, 'LONG');
  assert.ok(draft.stopPrice < draft.entryPrice);

  ledger.pendingDraft = draft;
  const exec = executeConfirmedDraft(ledger, sampleMarkets);
  assert.equal(exec.ok, true);
  assert.equal(ledger.positions.length, 1);
  assert.equal(ledger.cashUsd, 950); // $100 notional at 2x leverage = $50 margin

  const pf = computePortfolio(ledger, sampleMarkets);
  assert.equal(pf.equityUsd, 1000);
});

test('voice intent drafts a Polymarket YES bet and updates cash & active bets', () => {
  const ledger = freshLedger();
  const draft = parseVoiceIntent('bet 25 yes', sampleMarkets, { polyIndex: 0 });
  assert.equal(draft.kind, 'poly_bet');
  assert.equal(draft.outcome, 'YES');
  ledger.pendingDraft = draft;

  const exec = executeConfirmedDraft(ledger, sampleMarkets);
  assert.equal(exec.ok, true);
  assert.equal(ledger.bets.length, 1);
  assert.equal(ledger.cashUsd, 975);
});

test('close all returns margin + PnL and clears open positions', () => {
  const ledger = freshLedger();
  ledger.pendingDraft = parseVoiceIntent('short 200 eth', sampleMarkets);
  executeConfirmedDraft(ledger, sampleMarkets);
  assert.equal(ledger.positions.length, 1);

  const movedMarkets = {
    ...sampleMarkets,
    perps: sampleMarkets.perps.map((p) => (p.symbol === 'ETH' ? { ...p, markPrice: 3040 } : p)),
  };
  ledger.pendingDraft = parseVoiceIntent('close all', movedMarkets);
  const closed = executeConfirmedDraft(ledger, movedMarkets);
  assert.equal(closed.ok, true);
  assert.equal(closed.receipt.closedCount, 1);
  assert.equal(closed.receipt.realizedUsd, 10); // 5% drop on $200 short = +$10
  assert.equal(ledger.positions.length, 0);
  assert.equal(ledger.cashUsd, 1010);
});
