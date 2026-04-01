// MeetScribe — Popup

// Reuse an existing extension tab for a page instead of always opening a new one.
// Matches on base path so viewer.html?key=X reuses an already-open viewer.html tab.
async function openOrFocusTab(relPath) {
  const norm    = relPath.replace(/^\.\.\//, '');
  const fullUrl = chrome.runtime.getURL(norm);
  const pattern = chrome.runtime.getURL(norm.split('?')[0]) + '*';
  const [existing] = await chrome.tabs.query({ url: pattern });
  if (existing) {
    chrome.tabs.update(existing.id, { active: true, url: fullUrl });
    chrome.windows.update(existing.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: fullUrl });
  }
}

// Apply theme immediately (before DOMContentLoaded to avoid flash)
chrome.storage.local.get(['settings'], r => {
  document.documentElement.setAttribute('data-theme', r.settings?.theme || 'dark');
});

document.addEventListener('DOMContentLoaded', async () => {
  const session = await chrome.storage.session.get(['isRecording', 'currentMeetingKey', 'currentTitle']);
  updateRecordingStatus(session);

  const allMeetings = await chrome.runtime.sendMessage({ type: 'GET_MEETINGS' });
  // Filter out empty meetings (no captions captured)
  const meetings = (allMeetings || []).filter(m => m.entryCount > 0);
  renderMeetings(meetings);

  document.getElementById('settings-btn').addEventListener('click', () => {
    openOrFocusTab('../settings/settings.html');
  });

  document.getElementById('dashboard-btn').addEventListener('click', () => {
    openOrFocusTab('../dashboard/dashboard.html');
  });

  document.getElementById('stop-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes('meet.google.com')) {
      chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
    }
    window.close();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session') {
      chrome.storage.session.get(['isRecording', 'currentMeetingKey', 'currentTitle'], updateRecordingStatus);
    }
    if (area === 'local' && changes.meetingIndex) {
      renderMeetings(changes.meetingIndex.newValue || []);
    }
  });
});

function updateRecordingStatus(session) {
  const idleEl = document.getElementById('status-idle');
  const recEl = document.getElementById('status-recording');
  const titleEl = document.getElementById('current-title');

  if (session.isRecording) {
    idleEl.classList.add('hidden');
    recEl.classList.remove('hidden');
    titleEl.textContent = session.currentTitle || 'Meeting';
  } else {
    idleEl.classList.remove('hidden');
    recEl.classList.add('hidden');
  }
}

function renderMeetings(meetings) {
  const latestEl = document.getElementById('latest-meeting');
  const listEl = document.getElementById('meetings-list');

  if (!meetings || meetings.length === 0) {
    latestEl.className = 'card card-empty';
    latestEl.innerHTML = '<p class="empty-msg">No transcripts yet</p>';
    listEl.innerHTML = '<p class="empty-msg">No previous meetings</p>';
    return;
  }

  const latest = meetings[0];
  latestEl.className = 'card';
  latestEl.innerHTML = renderLatestCard(latest);
  latestEl.onclick = () => openTranscript(latest.key);

  const previous = meetings.slice(1, 10);
  if (previous.length === 0) {
    listEl.innerHTML = '<p class="empty-msg">No previous meetings</p>';
  } else {
    listEl.innerHTML = previous.map(renderMeetingRow).join('');
    listEl.querySelectorAll('.meeting-row').forEach((el, i) => {
      el.addEventListener('click', () => openTranscript(previous[i].key));
    });
  }
}

function renderLatestCard(m) {
  const date = fmtDate(m.startTime);
  const dur = m.durationMinutes || '?';
  const parts = m.participants?.length || 0;

  return `
    <div class="card-title">${esc(m.title || m.meetingId)}</div>
    <div class="card-meta">
      <span>${date}</span>
      <span>${dur} min</span>
      <span>${parts} participants</span>
    </div>
    <div class="card-actions">
      <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openTranscript('${m.key}')">View transcript</button>
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); doExport('${m.key}')">Export</button>
      ${m.hasSummary ? '<span class="badge badge-accent">Summary</span>' : ''}
    </div>
  `;
}

function renderMeetingRow(m) {
  const date = fmtShort(m.startTime);
  const dur = m.durationMinutes || '?';
  return `
    <div class="meeting-row">
      <div class="meeting-row-info">
        <div class="meeting-row-title">${esc(m.title || m.meetingId)}</div>
        <div class="meeting-row-meta">${date} &middot; ${dur} min</div>
      </div>
      ${m.hasSummary ? '<span class="badge badge-accent">AI</span>' : ''}
    </div>
  `;
}

function openTranscript(key) {
  openOrFocusTab(`../transcript/viewer.html?key=${encodeURIComponent(key)}`);
}
window.openTranscript = openTranscript;

function doExport(key) {
  chrome.runtime.sendMessage({ type: 'EXPORT_TRANSCRIPT', payload: { meetingKey: key, format: 'md' } });
}
window.doExport = doExport;

function fmtDate(s) {
  if (!s) return 'Unknown';
  return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtShort(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
