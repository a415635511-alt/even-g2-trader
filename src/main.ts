import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { formatEyewearScreen, type DeskState, type ViewMode } from './render.ts';

const VIEWS: ViewMode[] = ['perps', 'poly', 'desk'];

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null;
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT;
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

async function apiPost<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

async function tryConnectBridge(timeoutMs = 2500): Promise<EvenAppBridge | null> {
  try {
    return await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  const screenEl = document.getElementById('screen');
  const statusEl = document.getElementById('status');
  const logEl = document.getElementById('log');
  const voiceInput = document.getElementById('voiceInput') as HTMLInputElement | null;

  const log = (msg: string) => {
    if (!logEl) return;
    const row = document.createElement('div');
    row.textContent = `${new Date().toISOString().slice(11, 19)}  ${msg}`;
    logEl.prepend(row);
  };

  let bridge: EvenAppBridge | null = await tryConnectBridge();
  let viewIdx = 0;
  let perpIndex = 0;
  let polyIndex = 0;
  let micOpen = false;
  let banner = '';
  let pcmChunks = 0;
  let pcmBytes = 0;

  let state: DeskState = await apiGet<DeskState>('/api/state?refresh=1');

  if (statusEl) {
    statusEl.textContent = bridge
      ? `Even Hub Bridge connected · ${state.markets.sourceStatus}`
      : `Browser preview mode · ${state.markets.sourceStatus}`;
  }

  const paint = async () => {
    const text = formatEyewearScreen(state, VIEWS[viewIdx], perpIndex, polyIndex, micOpen, banner);
    if (screenEl) screenEl.textContent = text;
    if (bridge) {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 1,
          containerName: 'glancedesk',
          content: text,
        }),
      );
    }
  };

  const initialText = formatEyewearScreen(state, VIEWS[viewIdx], perpIndex, polyIndex, micOpen, banner);
  if (screenEl) screenEl.textContent = initialText;

  if (bridge) {
    const mainText = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 6,
      containerID: 1,
      containerName: 'glancedesk',
      content: initialText,
      isEventCapture: 1,
    });
    await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [mainText],
      }),
    );
    log('G2 startup container created (576x288)');
  } else {
    log('Running without Even Hub host (browser preview); simulator/G2 bridge activates automatically');
  }

  const refresh = async (force = false) => {
    try {
      state = await apiGet<DeskState>(`/api/state${force ? '?refresh=1' : ''}`);
      await paint();
    } catch (e) {
      banner = `Err: ${e instanceof Error ? e.message : String(e)}`;
      await paint();
    }
  };

  const submitVoiceDraft = async (text: string) => {
    try {
      const res = await apiPost<{ draft: { summary: string }; portfolio: DeskState['portfolio'] }>('/api/draft', {
        text,
        context: { perpIndex, polyIndex },
      });
      state = { ...state, portfolio: res.portfolio };
      banner = `Draft ready — tap to confirm`;
      log(`Drafted: ${res.draft.summary}`);
      await paint();
    } catch (e) {
      banner = e instanceof Error ? e.message : String(e);
      log(`Draft rejected: ${banner}`);
      await paint();
    }
  };

  const onTap = async () => {
    if (state.portfolio.pendingDraft) {
      try {
        const res = await apiPost<{ receipt: { summary: string; status: string }; portfolio: DeskState['portfolio'] }>(
          '/api/confirm',
        );
        state = { ...state, portfolio: res.portfolio };
        banner = `FILLED: ${res.receipt.summary}`;
        log(`Confirmed: ${res.receipt.summary} [${res.receipt.status}]`);
        await paint();
      } catch (e) {
        banner = e instanceof Error ? e.message : String(e);
        log(`Confirm failed: ${banner}`);
        await paint();
      }
      return;
    }

    const view = VIEWS[viewIdx];
    banner = '';
    if (view === 'perps') {
      perpIndex += 1;
      await paint();
    } else if (view === 'poly') {
      polyIndex += 1;
      await paint();
    } else {
      await refresh(true);
    }
  };

  const onScroll = async (dir: 1 | -1 = 1) => {
    if (state.portfolio.pendingDraft) return;
    banner = '';
    viewIdx = (viewIdx + dir + VIEWS.length) % VIEWS.length;
    await paint();
  };

  const onDoubleTap = async () => {
    if (state.portfolio.pendingDraft) {
      const res = await apiPost<{ portfolio: DeskState['portfolio'] }>('/api/cancel');
      state = { ...state, portfolio: res.portfolio };
      banner = 'Draft cancelled';
      log('Pending draft cancelled');
      await paint();
      return;
    }

    const view = VIEWS[viewIdx];
    if (view === 'perps') {
      const p = state.markets.perps[perpIndex % Math.max(1, state.markets.perps.length)];
      if (p) await submitVoiceDraft(`long 50 ${p.symbol}`);
    } else if (view === 'poly') {
      await submitVoiceDraft('bet 25 yes');
    } else if (state.portfolio.positions.length > 0) {
      await submitVoiceDraft('close all');
    } else {
      banner = 'No open positions to close';
      await paint();
    }
  };

  const onToggleMic = async () => {
    micOpen = !micOpen;
    if (bridge) {
      await bridge.audioControl(micOpen);
    }
    if (!micOpen && pcmBytes > 0) {
      const res = await apiPost<{ capturedBytes: number; note: string }>('/api/audio-pcm', {
        byteLength: pcmBytes,
      });
      banner = `Mic sent ${res.capturedBytes}B PCM`;
      log(res.note);
      pcmChunks = 0;
      pcmBytes = 0;
    } else {
      banner = micOpen ? 'Mic open — speak command' : 'Mic closed';
    }
    await paint();
  };

  document.getElementById('btnTap')?.addEventListener('click', () => void onTap());
  document.getElementById('btnScroll')?.addEventListener('click', () => void onScroll(1));
  document.getElementById('btnDouble')?.addEventListener('click', () => void onDoubleTap());
  document.getElementById('btnMic')?.addEventListener('click', () => void onToggleMic());
  document.getElementById('btnSendVoice')?.addEventListener('click', () => {
    const val = voiceInput?.value.trim() || '';
    if (val) {
      void submitVoiceDraft(val);
      if (voiceInput) voiceInput.value = '';
    }
  });
  voiceInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && voiceInput.value.trim()) {
      void submitVoiceDraft(voiceInput.value.trim());
      voiceInput.value = '';
    }
  });

  const timer = window.setInterval(() => void refresh(false), 15_000);

  if (bridge) {
    const unsubscribe = bridge.onEvenHubEvent(async (event) => {
      if (event.audioEvent?.audioPcm) {
        pcmChunks += 1;
        pcmBytes += event.audioEvent.audioPcm.length;
        if (pcmChunks % 15 === 0) {
          log(`G2 Mic PCM stream: ${pcmBytes} bytes`);
        }
        return;
      }

      const sysType = eventTypeOf(event.sysEvent);
      const textType = eventTypeOf(event.textEvent);

      if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        await onDoubleTap();
        return;
      }
      if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
        await onScroll(-1);
        return;
      }
      if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        await onScroll(1);
        return;
      }
      if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
        await onTap();
        return;
      }
      if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
        window.clearInterval(timer);
        unsubscribe();
      }
    });
  }
}

void boot();
