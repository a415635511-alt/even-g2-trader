# G2 GlanceDesk — Read-and-Write Trading & Prediction Copilot for Even Realities G2

A glanceable, hands-free **Even Realities G2** app (`576×288` monochrome display + R1 ring / temple touch + microphone PCM) built for **Track 02 · Crypto & DeFi** (Hyperliquid + Polymarket) with optional Telegram alert bridge.

> **Safety & Competition Disclosure**
> - Built from scratch on **Nov 23, 2026** (after kickoff) as a new codebase in `even-g2-trader`.
> - **Paper / Testnet only** — uses live Hyperliquid perpetual prices (`api.hyperliquid.xyz/info`) and live Polymarket odds (`gamma-api.polymarket.com`) against a local paper ledger with hard 2% stop-loss bounds. Never holds user funds, never ships API keys inside the WebView, no financial advice.

## Problem

Active crypto & prediction-market traders miss sudden funding spikes, price breaks, and odds shifts while away from their desk — or fumble through 6 taps on a phone screen just to open or flatten a position.

## How G2 GlanceDesk Works (Read → Draft → One-Tap Confirm)

1. **Glance (Read):** Cycles live Hyperliquid perpetuals (BTC, ETH, SOL, top funding movers) and top-volume Polymarket markets on a crisp 4–5 line `576×288` green monochrome layout.
2. **Voice or Quick Draft (Write):** Speak a concise command into the G2 mic (e.g. `"long 100 btc"`, `"short 50 eth"`, `"bet 25 yes"`, `"close all"`) — or double-tap for a bounded quick draft (`$50 LONG` / `$25 YES` / `CLOSE ALL`).
3. **One-Tap Confirm / Double-Tap Cancel:** Every write action enters a 90-second `CONFIRM ACTION` state showing exact mark price, size, and hard 2% stop-loss. Single tap executes on the backend; double tap cancels immediately.
4. **Optional Telegram Bridge:** When `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set on the backend, every confirmed fill sends an instant confirmation message to Telegram.

## Controls on Even G2 / R1 Ring

| Gesture | Normal View (HL Perps / Polymarket / Desk) | Pending Confirmation |
|---|---|---|
| **Single Tap** | Next symbol/market (or refresh Desk) | **CONFIRM** & execute paper order |
| **Scroll Up/Down** | Switch between HL Perps ↔ Polymarket ↔ Portfolio Desk | Locked while confirming |
| **Double Tap** | Draft bounded quick order (`$50 LONG` / `$25 YES` / `CLOSE ALL`) | **CANCEL** draft |
| **Mic Toggle** | Stream raw G2 PCM audio (`bridge.audioControl`) to backend `/api/audio-pcm` | — |

## Quick Start

```bash
npm install
npm test                # 4/4 unit tests (parsers, voice intent, confirm & close-all)
npm run server          # starts local backend on http://127.0.0.1:8791
npm run dev             # starts Vite dev server on http://localhost:5173 (proxies /api -> 8791)
```

To run in the **Even Hub Simulator** or package `.ehpk`:

```bash
npm run simulate        # opens Even Hub simulator pointed at http://localhost:5173
npm run pack            # builds and stamps out.ehpk via evenhub-cli
```

## Architecture

- `src/main.ts` — Even Hub SDK (`@evenrealities/even_hub_sdk`) integration: `CreateStartUpPageContainer`, `TextContainerUpgrade`, `onEvenHubEvent`, `audioControl(boolean)`, with automatic browser preview fallback when no G2 host is present.
- `src/render.ts` — Monochrome `576×288` text formatter (4–5 lines, <=54 chars/line, confirmation-first priority).
- `server/engine.mjs` + `server/index.mjs` — Pure-Node backend (zero external runtime deps) that fetches live Hyperliquid & Polymarket feeds, parses voice intents into bounded drafts, executes confirmed paper orders, and optionally dispatches Telegram alerts.
- `app.json` — Even Hub manifest (`com.eudatalabs.g2desk`, `network` permission).

## API Feature Requests (for Hackathon Submission)

1. **Hyperliquid:** Native testnet faucet API endpoint for automated hackathon & CI verification without manual UI clicks.
2. **Polymarket:** Lightweight `/markets/glance` summary endpoint returning top N active markets with pre-parsed numeric `yesPrice`/`noPrice` instead of stringified JSON arrays (`outcomePrices`).
3. **Even Hub SDK:** Built-in optional on-device/host push-to-talk VAD + transcript event so small G2 apps do not need every developer to host a custom Whisper PCM server.
4. **Even Hub Simulator:** Documented HTTP automation endpoints on `--automation-port` (e.g. `/screenshot`, `/gesture`) for headless CI testing and demo recording.
5. **Telegram Bot API:** First-class inline confirmation webhook tailored for wearable one-tap approve/reject flows.

## License

MIT
