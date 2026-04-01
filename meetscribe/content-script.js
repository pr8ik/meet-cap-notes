// MeetScribe — Content Script
// Caption capture based on REAL Google Meet DOM (inspected April 2026)
//
// Actual DOM structure (NO aria-live on captions!):
//   .a4cQT (caption region)
//     └─ .nMcdL (per-speaker block)
//          ├─ .adE6rb > .KcIKyf > SPAN.NWpY1d  (speaker name)
//          └─ .VbkSUe                            (caption text)
//
// Fallback: [jsname="dsyhDe"] parent .iOzk7 structure

// ─── Selectors (verified against live DOM) ───────────────────────────
const SEL = {
  // PRIMARY — caption-specific (verified April 2026)
  captionRegion:   '.a4cQT',
  captionBlock:    '.nMcdL',
  speakerName:     '.NWpY1d',
  speakerWrap:     '.KcIKyf',
  captionText:     '.VbkSUe',

  // FALLBACK — structural
  captionJsname:   '[jsname="dsyhDe"]',
  captionWrapAlt:  '.iOzk7',
  captionBlockAlt: '.bj4p3b',

  // Meeting chrome
  leaveButton:     'button[aria-label*="Leave call"], button[aria-label*="End call"]',
  joinButton:      'button[aria-label*="Join now"], button[aria-label*="Ask to join"], button[jsname="Qx7uuf"]',
  meetingTitle:    '[data-meeting-title], .u6vdEc, .roSPhc',
  participantImg:  'div[data-self-name] img[title], div.U04fid img[title]',
};

const SYSTEM_MSG = /^(you (have |'ve )?(joined|left|ended)|return(ing)? to home|leave call|audio and video|learn more|recording (start|stop)|is presenting|you're the only|waiting for other|someone has joined|you've been admitted|your (camera|microphone|hand|video) is|turning on captions|captions are now|live caption|no one else is here|people in this call|this call is being recorded|call ended|microphone \(|speakers \(|integrated webcam|in \d+ (second|minute)|others might still|you are the first)/i;

const MEETING_ID_RE = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/;

// ─── State ───────────────────────────────────────────────────────────
let isCapturing = false;
let inMeeting = false;       // True only after join button disappears / leave button appears
let buffer = [];
let activeSegments = new Map();
let lastSpeaker = 'Unknown Speaker';
let meetingStartTime = null;
let captionsSeen = false;
let totalCaptured = 0;
let port = null;
let lastCaptionSnapshot = ''; // For text-diff detection

// Intervals/observers
let captionObserver = null;
let meetingDetector = null;
let pollInterval = null;
let flushInterval = null;
let keepAliveInterval = null;
let healthCheckInterval = null;

const MAX_BUFFER = 500;
const DEBUG = true;

function log(...args) { if (DEBUG) console.log('[MeetScribe]', ...args); }

// ─── Meeting metadata ────────────────────────────────────────────────
function getMeetingId() {
  const m = window.location.href.match(MEETING_ID_RE);
  return m ? m[1] : 'unknown';
}

function getMeetingTitle() {
  for (const sel of SEL.meetingTitle.split(', ')) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return getMeetingId();
}

function getParticipants() {
  const names = new Set();
  document.querySelectorAll(SEL.participantImg).forEach(img => {
    const n = img.getAttribute('title');
    if (n) names.add(n.trim());
  });
  return [...names];
}

function checkInMeeting() {
  return !!document.querySelector(SEL.leaveButton);
}

function checkInWaitingRoom() {
  return !!document.querySelector(SEL.joinButton);
}

function getStorageKey() {
  const now = new Date();
  return `meet_${getMeetingId()}_${now.toISOString().split('T')[0]}T${now.toTimeString().slice(0,8).replace(/:/g,'-')}`;
}

// ─── System message filter (FIRST in pipeline) ──────────────────────
function isSystemMessage(text) {
  if (!text || text.length < 3) return true;
  return SYSTEM_MSG.test(text.trim());
}

// ─── Caption extraction (verified against real DOM) ──────────────────
function extractCaptions() {
  const results = [];

  // Strategy 1: Use .a4cQT > .nMcdL structure (primary)
  const region = document.querySelector(SEL.captionRegion);
  if (region) {
    const blocks = region.querySelectorAll(SEL.captionBlock);
    for (const block of blocks) {
      const speakerEl = block.querySelector(SEL.speakerName) || block.querySelector(SEL.speakerWrap);
      const textEl = block.querySelector(SEL.captionText);
      if (textEl) {
        const text = textEl.textContent?.trim();
        const speaker = speakerEl?.textContent?.trim() || lastSpeaker;
        if (text && !isSystemMessage(text)) {
          results.push({ speaker, text });
        }
      }
    }
    if (results.length > 0) return results;
  }

  // Strategy 2: Use [jsname="dsyhDe"] / .bj4p3b fallback
  const altContainers = document.querySelectorAll(`${SEL.captionJsname}, ${SEL.captionBlockAlt}`);
  for (const container of altContainers) {
    const speakerEl = container.querySelector(SEL.speakerName) || container.querySelector(SEL.speakerWrap);
    const textEl = container.querySelector(SEL.captionText);
    if (textEl) {
      const text = textEl.textContent?.trim();
      const speaker = speakerEl?.textContent?.trim() || lastSpeaker;
      if (text && !isSystemMessage(text)) {
        results.push({ speaker, text });
      }
    }
  }
  if (results.length > 0) return results;

  // Strategy 3: Broad text-diff on caption region
  if (region) {
    const currentText = region.textContent?.trim() || '';
    if (currentText && currentText !== lastCaptionSnapshot) {
      // Find what's new
      const newPart = currentText.replace(lastCaptionSnapshot, '').trim();
      if (newPart && !isSystemMessage(newPart) && newPart.length > 3) {
        results.push({ speaker: lastSpeaker, text: newPart });
      }
    }
    lastCaptionSnapshot = currentText;
  }

  return results;
}

// ─── Process extracted captions ──────────────────────────────────────
function processCaptions(results) {
  for (const { speaker, text } of results) {
    if (isSystemMessage(text)) continue;
    handleCaption(speaker, text);
  }
}

function handleCaption(speaker, text) {
  if (!captionsSeen) {
    captionsSeen = true;
    totalCaptured = 0;
    log('First caption detected!', speaker, ':', text.substring(0, 60));
    updateWidget('active');
  }

  const existing = activeSegments.get(speaker);
  const now = Date.now();

  if (!existing) {
    activeSegments.set(speaker, { speaker, text, timestamp: now });
  } else if (text === existing.text) {
    return; // Exact duplicate
  } else if (text.startsWith(existing.text) || text.length > existing.text.length + 3) {
    existing.text = text; // Growing text
  } else {
    flushSegment(existing); // New sentence
    activeSegments.set(speaker, { speaker, text, timestamp: now });
  }

  lastSpeaker = speaker;
}

function flushSegment(seg) {
  if (isSystemMessage(seg.text)) return;

  buffer.push({
    speaker: seg.speaker,
    text: seg.text,
    timestamp: new Date(seg.timestamp).toISOString(),
    offsetSeconds: meetingStartTime ? Math.round((seg.timestamp - meetingStartTime) / 1000) : 0
  });
  totalCaptured++;
  log(`[${totalCaptured}] ${seg.speaker}: ${seg.text.substring(0, 80)}`);

  if (buffer.length > MAX_BUFFER) flushToStorage();
}

// ─── Observe caption region ──────────────────────────────────────────
function startCaptionObserver() {
  if (captionObserver) captionObserver.disconnect();

  const region = document.querySelector(SEL.captionRegion);
  if (region) {
    log('Caption region .a4cQT found! Observing...');
    captionObserver = new MutationObserver(() => {
      processCaptions(extractCaptions());
    });
    captionObserver.observe(region, { childList: true, characterData: true, subtree: true });
    // Immediate extract
    processCaptions(extractCaptions());
    return true;
  }

  // Fallback: observe jsname container
  const alt = document.querySelector(SEL.captionJsname)?.closest('.a4cQT, .DtJ7e, [class*="caption"]');
  if (alt) {
    log('Fallback caption container found:', alt.className.substring(0, 40));
    captionObserver = new MutationObserver(() => {
      processCaptions(extractCaptions());
    });
    captionObserver.observe(alt, { childList: true, characterData: true, subtree: true });
    processCaptions(extractCaptions());
    return true;
  }

  return false;
}

// ─── Polling (finds caption region + extracts as safety net) ─────────
function startPolling() {
  pollInterval = setInterval(() => {
    if (!isCapturing) return;

    // Try to find/reattach caption observer if not attached
    if (!captionObserver) {
      startCaptionObserver();
    } else {
      // Check if our observed element is still in the DOM
      const region = document.querySelector(SEL.captionRegion);
      if (!region) {
        captionObserver.disconnect();
        captionObserver = null;
      }
    }

    // Poll-extract as safety net
    processCaptions(extractCaptions());

    // Check if meeting ended
    if (!checkInMeeting() && isCapturing && captionsSeen && inMeeting) {
      log('Meeting ended (leave button gone)');
      stopCapture('meeting_ended');
    }
  }, 2000);
}

// ─── Storage ─────────────────────────────────────────────────────────
function flushAllActive() {
  for (const [, seg] of activeSegments) flushSegment(seg);
  activeSegments.clear();
}

async function flushToStorage() {
  if (buffer.length === 0) return;
  const entries = [...buffer];
  buffer = [];

  try {
    await chrome.runtime.sendMessage({
      type: 'FLUSH_BUFFER',
      payload: {
        meetingKey: state.storageKey,
        entries,
        metadata: {
          meetingId: getMeetingId(),
          title: getMeetingTitle(),
          participants: getParticipants(),
          startTime: meetingStartTime ? new Date(meetingStartTime).toISOString() : null,
        }
      }
    });
    log(`Flushed ${entries.length} entries`);
  } catch (e) {
    log('Flush failed:', e.message);
    buffer.unshift(...entries);
    reconnectPort();
  }
}

// ─── Port keep-alive ─────────────────────────────────────────────────
function connectPort() {
  try {
    port = chrome.runtime.connect({ name: 'recording-session' });
    port.onDisconnect.addListener(() => { port = null; });
  } catch (e) { port = null; }
}
function reconnectPort() { if (!port && isCapturing) connectPort(); }

// ─── State ───────────────────────────────────────────────────────────
const state = { storageKey: null };

// ─── Meeting detection (waiting room vs actual meeting) ──────────────
function startMeetingDetector() {
  log('Watching for meeting join...');

  meetingDetector = setInterval(() => {
    const nowInMeeting = checkInMeeting();
    const inWaiting = checkInWaitingRoom();

    if (nowInMeeting && !inMeeting) {
      inMeeting = true;
      log('Joined meeting! Leave button detected.');

      // If user had already clicked "Start Capture" from waiting room, now actually begin
      if (isCapturing) {
        log('Capture was pending from waiting room — now starting real capture');
        beginRealCapture();
      }
    }

    if (!nowInMeeting && inMeeting && isCapturing && captionsSeen) {
      log('Left meeting');
      stopCapture('meeting_ended');
      inMeeting = false;
    }
  }, 1000);
}

// ─── Start / Stop ────────────────────────────────────────────────────
function requestCapture() {
  // Called when user clicks "Start Capture" — may be in waiting room
  if (isCapturing) return;
  isCapturing = true;
  meetingStartTime = Date.now();
  state.storageKey = getStorageKey();
  buffer = [];
  activeSegments.clear();
  captionsSeen = false;
  totalCaptured = 0;
  lastCaptionSnapshot = '';

  log('Capture requested. Key:', state.storageKey);

  // Notify service worker immediately
  connectPort();
  chrome.runtime.sendMessage({
    type: 'CAPTURE_STARTED',
    payload: {
      meetingKey: state.storageKey,
      meetingId: getMeetingId(),
      title: getMeetingTitle(),
      startTime: new Date(meetingStartTime).toISOString()
    }
  });

  if (checkInMeeting()) {
    inMeeting = true;
    beginRealCapture();
  } else {
    // In waiting room — show pending state, will activate on join
    createWidget();
    updateWidget('pending');
    log('In waiting room — capture will begin on meeting join');
  }
}

function beginRealCapture() {
  // Actually start observing captions (only called when in-meeting)
  createWidget();
  updateWidget('waiting');

  startCaptionObserver();
  startPolling();

  flushInterval = setInterval(() => { flushAllActive(); flushToStorage(); }, 30000);
  keepAliveInterval = setInterval(() => {
    if (port) { try { port.postMessage({ type: 'PING' }); } catch (e) { reconnectPort(); } }
    else reconnectPort();
  }, 25000);

  // Health monitoring
  healthCheckInterval = setInterval(() => {
    if (!isCapturing) return;
    const elapsed = (Date.now() - meetingStartTime) / 1000;
    if (!captionsSeen && elapsed > 15) {
      updateWidget('warning');
    }
  }, 5000);
}

function stopCapture(reason = 'user_stopped') {
  if (!isCapturing) return;
  log('Stopping. Reason:', reason, '| Captured:', totalCaptured);
  isCapturing = false;

  flushAllActive();

  const doStop = async () => {
    await flushToStorage();

    if (captionObserver) { captionObserver.disconnect(); captionObserver = null; }
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
    if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }
    if (port) { port.disconnect(); port = null; }

    chrome.runtime.sendMessage({
      type: 'CAPTURE_STOPPED',
      payload: {
        meetingKey: state.storageKey, reason,
        endTime: new Date().toISOString(),
        meetingId: getMeetingId(),
        title: getMeetingTitle(),
        participants: getParticipants()
      }
    });

    updateWidget('stopped');
    setTimeout(removeWidget, 4000);
  };

  doStop();
}

// ─── Status Widget (bottom-right, persistent) ────────────────────────
let widgetEl = null;

function createWidget() {
  removeWidget();
  widgetEl = document.createElement('div');
  widgetEl.id = 'meetscribe-widget';
  widgetEl.innerHTML = `
    <div class="ms-widget-inner">
      <div class="ms-widget-dot"></div>
      <span class="ms-widget-text">Starting...</span>
      <span class="ms-widget-count hidden" id="ms-count">0</span>
      <button class="ms-widget-stop" id="ms-stop-btn" title="Stop recording">Stop</button>
    </div>
  `;
  document.body.appendChild(widgetEl);
  document.getElementById('ms-stop-btn').addEventListener('click', () => stopCapture('user_stopped'));
}

function updateWidget(status) {
  if (!widgetEl) return;
  const dot = widgetEl.querySelector('.ms-widget-dot');
  const text = widgetEl.querySelector('.ms-widget-text');
  const count = widgetEl.querySelector('#ms-count');

  widgetEl.className = `ms-widget-${status}`;

  switch (status) {
    case 'pending':
      text.textContent = 'Waiting to join meeting...';
      dot.className = 'ms-widget-dot ms-dot-waiting';
      count.classList.add('hidden');
      break;
    case 'waiting':
      text.textContent = 'Listening for captions...';
      dot.className = 'ms-widget-dot ms-dot-waiting';
      count.classList.add('hidden');
      break;
    case 'active':
      text.textContent = 'Capturing';
      dot.className = 'ms-widget-dot ms-dot-active';
      count.classList.remove('hidden');
      count.textContent = totalCaptured;
      if (!widgetEl._countInterval) {
        widgetEl._countInterval = setInterval(() => {
          if (count) count.textContent = totalCaptured;
        }, 2000);
      }
      break;
    case 'warning':
      text.textContent = 'No captions detected. Turn on captions (press C)';
      dot.className = 'ms-widget-dot ms-dot-warning';
      count.classList.add('hidden');
      widgetEl.classList.add('ms-widget-expanded');
      break;
    case 'stopped':
      text.textContent = totalCaptured > 0 ? `Saved (${totalCaptured} entries)` : 'Stopped (no captions captured)';
      dot.className = 'ms-widget-dot ms-dot-done';
      count.classList.add('hidden');
      const btn = widgetEl.querySelector('.ms-widget-stop');
      if (btn) btn.style.display = 'none';
      if (widgetEl._countInterval) clearInterval(widgetEl._countInterval);
      break;
  }
}

function removeWidget() {
  if (widgetEl) {
    if (widgetEl._countInterval) clearInterval(widgetEl._countInterval);
    widgetEl.remove();
    widgetEl = null;
  }
}

// ─── Top banner (initial prompt) ─────────────────────────────────────
let bannerEl = null;
let bannerDismissTimer = null;

function createBanner() {
  if (bannerEl) return;
  bannerEl = document.createElement('div');
  bannerEl.id = 'meetscribe-banner';
  bannerEl.innerHTML = `
    <div class="meetscribe-banner-inner">
      <span class="meetscribe-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </span>
      <span class="meetscribe-text">MeetScribe ready</span>
      <button class="meetscribe-btn meetscribe-btn-primary" id="meetscribe-start">Start Capture</button>
      <button class="meetscribe-btn meetscribe-btn-secondary" id="meetscribe-skip">Skip</button>
    </div>
  `;
  document.body.appendChild(bannerEl);

  document.getElementById('meetscribe-start').addEventListener('click', () => {
    removeBanner();
    requestCapture();
  });
  document.getElementById('meetscribe-skip').addEventListener('click', removeBanner);

  chrome.storage.local.get(['settings'], (r) => {
    const ms = r.settings?.bannerDismissTime || 0;
    if (ms > 0) {
      bannerDismissTimer = setTimeout(() => {
        if (bannerEl && !isCapturing) removeBanner();
      }, ms);
    }
  });
}

function removeBanner() {
  if (bannerDismissTimer) { clearTimeout(bannerDismissTimer); bannerDismissTimer = null; }
  if (bannerEl) { bannerEl.remove(); bannerEl = null; }
}

// ─── Message listener ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'START_RECORDING':
      requestCapture();
      sendResponse({ ok: true });
      break;
    case 'STOP_RECORDING':
      stopCapture('user_stopped');
      sendResponse({ ok: true });
      break;
    case 'GET_STATUS':
      sendResponse({
        isCapturing, captionsSeen, totalCaptured, inMeeting,
        meetingId: getMeetingId(), title: getMeetingTitle(),
        meetingKey: state.storageKey,
      });
      break;
  }
  return true;
});

// ─── Lifecycle ───────────────────────────────────────────────────────
let lastUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    if (isCapturing && !window.location.href.match(MEETING_ID_RE)) stopCapture('navigated_away');
  }
}, 1000);

window.addEventListener('beforeunload', () => {
  if (!isCapturing) return;
  flushAllActive();
  try {
    chrome.runtime.sendMessage({ type: 'FLUSH_BUFFER', payload: { meetingKey: state.storageKey, entries: buffer, metadata: { meetingId: getMeetingId(), title: getMeetingTitle(), participants: getParticipants(), startTime: meetingStartTime ? new Date(meetingStartTime).toISOString() : null } } });
    chrome.runtime.sendMessage({ type: 'CAPTURE_STOPPED', payload: { meetingKey: state.storageKey, reason: 'tab_closed', endTime: new Date().toISOString(), meetingId: getMeetingId(), title: getMeetingTitle(), participants: getParticipants() } });
  } catch (e) { /* best effort */ }
});

// ─── Init ────────────────────────────────────────────────────────────
function init() {
  if (getMeetingId() === 'unknown') return;
  log('MeetScribe loaded on:', getMeetingId());

  // Start watching for meeting join
  startMeetingDetector();

  setTimeout(() => {
    chrome.storage.local.get(['settings'], (r) => {
      if (r.settings?.autoPrompt === false) return;
      createBanner();
    });
  }, 2000);
}

init();
