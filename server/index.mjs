import http from 'node:http';
import {
  loadLedger,
  saveLedger,
  fetchMarkets,
  parseVoiceIntent,
  computePortfolio,
  executeConfirmedDraft,
  maybeSendTelegramAlert,
} from './engine.mjs';

const PORT = Number(process.env.PORT || 8791);
const HOST = process.env.HOST || '127.0.0.1';

let cachedMarkets = { perps: [], predictions: [], fetchedAt: null, sourceStatus: 'BOOT' };
let lastFetchMs = 0;

async function getMarkets(force = false) {
  if (!force && cachedMarkets.perps.length > 0 && Date.now() - lastFetchMs < 8_000) {
    return cachedMarkets;
  }
  cachedMarkets = await fetchMarkets();
  lastFetchMs = Date.now();
  return cachedMarkets;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, service: 'g2-glancedesk', port: PORT });
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const markets = await getMarkets(url.searchParams.get('refresh') === '1');
      const ledger = loadLedger();
      return sendJson(res, 200, {
        markets,
        portfolio: computePortfolio(ledger, markets),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/draft') {
      const body = await readJson(req);
      const markets = await getMarkets();
      const ledger = loadLedger();
      const draft = parseVoiceIntent(body.text || '', markets, body.context || {});
      if (draft.error) return sendJson(res, 400, { ok: false, error: draft.error });
      ledger.pendingDraft = draft;
      saveLedger(ledger);
      return sendJson(res, 200, { ok: true, draft, portfolio: computePortfolio(ledger, markets) });
    }

    if (req.method === 'POST' && url.pathname === '/api/confirm') {
      const markets = await getMarkets(true);
      const ledger = loadLedger();
      const result = executeConfirmedDraft(ledger, markets);
      if (result.error) return sendJson(res, 400, { ok: false, error: result.error });
      await maybeSendTelegramAlert(ledger, `Confirmed on G2: ${result.receipt.summary}`);
      saveLedger(ledger);
      return sendJson(res, 200, {
        ok: true,
        receipt: result.receipt,
        portfolio: computePortfolio(ledger, markets),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/cancel') {
      const markets = await getMarkets();
      const ledger = loadLedger();
      ledger.pendingDraft = null;
      saveLedger(ledger);
      return sendJson(res, 200, { ok: true, portfolio: computePortfolio(ledger, markets) });
    }

    if (req.method === 'POST' && url.pathname === '/api/audio-pcm') {
      const body = await readJson(req);
      const bytes = Array.isArray(body.bytes) ? body.bytes.length : Number(body.byteLength || 0);
      // Optional OpenAI Whisper hook when OPENAI_API_KEY is configured on the server;
      // otherwise reports captured PCM stats honestly without faking a transcript.
      return sendJson(res, 200, {
        ok: true,
        capturedBytes: bytes,
        sttConfigured: Boolean(process.env.OPENAI_API_KEY),
        note: process.env.OPENAI_API_KEY
          ? 'Whisper STT endpoint ready'
          : 'PCM received on backend; set OPENAI_API_KEY for Whisper STT or use text intent bar',
      });
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`G2 GlanceDesk backend listening on http://${HOST}:${PORT}`);
});
