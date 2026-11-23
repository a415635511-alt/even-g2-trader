export interface PerpItem {
  symbol: string;
  markPrice: number;
  change24hPct: number | null;
  fundingAprPct: number;
  openInterestUsd: number;
}

export interface PolyItem {
  id: string;
  question: string;
  yesPct: number;
  noPct: number;
  volume24hUsd: number;
}

export interface DraftAction {
  id: string;
  kind: 'hl_order' | 'poly_bet' | 'close_all';
  summary: string;
  expiresAt: string;
}

export interface PositionItem {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  notionalUsd: number;
  entryPrice: number;
  markPrice: number;
  stopPrice: number;
  pnlUsd: number;
}

export interface BetItem {
  id: string;
  question: string;
  outcome: 'YES' | 'NO';
  amountUsd: number;
  entryProb: number;
  curProb: number;
  pnlUsd: number;
}

export interface DeskState {
  markets: {
    perps: PerpItem[];
    predictions: PolyItem[];
    fetchedAt: string | null;
    sourceStatus: string;
  };
  portfolio: {
    mode: string;
    cashUsd: number;
    equityUsd: number;
    unrealizedUsd: number;
    totalPnlUsd: number;
    positions: PositionItem[];
    bets: BetItem[];
    pendingDraft: DraftAction | null;
    orderCount: number;
    lastOrder: { summary?: string; status?: string } | null;
  };
}

export type ViewMode = 'perps' | 'poly' | 'desk';

function fmtPrice(n: number): string {
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}

/**
 * Render concise, glanceable monochrome text tailored for Even G2 (576x288).
 * Never dumps dashboards — always 4-5 crisp lines, max ~54 chars/line.
 */
export function formatEyewearScreen(
  state: DeskState,
  view: ViewMode,
  perpIndex: number,
  polyIndex: number,
  micOpen: boolean,
  banner = '',
): string {
  const { markets, portfolio } = state;
  const ts = markets.fetchedAt ? markets.fetchedAt.slice(11, 19) + 'Z' : '--:--:--';
  const micTag = micOpen ? ' [MIC]' : '';

  // Pending write confirmation ALWAYS takes priority on screen — one tap executes, 2x tap cancels.
  if (portfolio.pendingDraft) {
    const d = portfolio.pendingDraft;
    return [
      `CONFIRM ACTION${micTag} · PAPER LIVE`,
      d.summary.slice(0, 54),
      `Equity: $${portfolio.equityUsd.toFixed(2)} | Cash: $${portfolio.cashUsd.toFixed(2)}`,
      banner ? banner.slice(0, 54) : `Safety: hard 2% SL · testnet/paper only`,
      `Tap: CONFIRM · 2xTap: CANCEL`,
    ].join('\n');
  }

  if (view === 'perps') {
    if (markets.perps.length === 0) {
      return `G2 GLANCEDESK · HYPERLIQUID${micTag}\nNo live perp feed (${markets.sourceStatus})\nTap: retry · Scroll: switch view`;
    }
    const idx = ((perpIndex % markets.perps.length) + markets.perps.length) % markets.perps.length;
    const p = markets.perps[idx];
    const chg = p.change24hPct === null ? 'n/a' : `${p.change24hPct >= 0 ? '+' : ''}${p.change24hPct.toFixed(1)}%`;
    const apr = `${p.fundingAprPct >= 0 ? '+' : ''}${p.fundingAprPct.toFixed(1)}% APR`;
    return [
      `HL PERP [${idx + 1}/${markets.perps.length}] ${ts}${micTag}`,
      `${p.symbol}  ${fmtPrice(p.markPrice)}  (${chg})`,
      `Funding: ${apr} | OI: ${fmtUsd(p.openInterestUsd)}`,
      banner ? banner.slice(0, 54) : `Desk Eq $${portfolio.equityUsd.toFixed(0)} (${fmtSigned(portfolio.totalPnlUsd)})`,
      `Tap: next · Scroll: Poly/Desk · 2xTap: quick $50 LONG`,
    ].join('\n');
  }

  if (view === 'poly') {
    if (markets.predictions.length === 0) {
      return `G2 GLANCEDESK · POLYMARKET${micTag}\nNo live odds (${markets.sourceStatus})\nTap: retry · Scroll: switch view`;
    }
    const idx = ((polyIndex % markets.predictions.length) + markets.predictions.length) % markets.predictions.length;
    const m = markets.predictions[idx];
    const q = m.question.length > 52 ? `${m.question.slice(0, 49)}...` : m.question;
    return [
      `POLYMARKET [${idx + 1}/${markets.predictions.length}] ${ts}${micTag}`,
      q,
      `YES ${m.yesPct.toFixed(1)}%  |  NO ${m.noPct.toFixed(1)}%  |  Vol ${fmtUsd(m.volume24hUsd)}`,
      banner ? banner.slice(0, 54) : `Active bets: ${portfolio.bets.length} · Cash $${portfolio.cashUsd.toFixed(0)}`,
      `Tap: next · Scroll: Desk/HL · 2xTap: quick $25 YES`,
    ].join('\n');
  }

  // Desk / Portfolio view
  const posLine =
    portfolio.positions.length > 0
      ? portfolio.positions
          .slice(0, 2)
          .map((p) => `${p.side[0]} ${p.symbol} $${p.notionalUsd} ${fmtSigned(p.pnlUsd)}`)
          .join(' | ')
      : 'No open perp positions';
  const betLine =
    portfolio.bets.length > 0
      ? `Bets(${portfolio.bets.length}): ${portfolio.bets[0].outcome} $${portfolio.bets[0].amountUsd} ${fmtSigned(portfolio.bets[0].pnlUsd)}`
      : `Orders filled: ${portfolio.orderCount}`;

  return [
    `GLANCEDESK PORTFOLIO ${ts}${micTag}`,
    `Equity $${portfolio.equityUsd.toFixed(2)} | PnL ${fmtSigned(portfolio.totalPnlUsd)}`,
    posLine.slice(0, 54),
    banner ? banner.slice(0, 54) : betLine.slice(0, 54),
    `Tap: refresh · Scroll: HL/Poly · 2xTap: draft CLOSE ALL`,
  ].join('\n');
}
