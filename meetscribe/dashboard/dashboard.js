// MeetScribe — Dashboard

chrome.storage.local.get(['settings'], r => {
  document.documentElement.setAttribute('data-theme', r.settings?.theme || 'dark');
});

let allMeetings = [];
let hideEmpty = true;

function getVisible() {
  let list = allMeetings;
  if (hideEmpty) list = list.filter(m => m.entryCount > 0);
  return list;
}

document.addEventListener('DOMContentLoaded', async () => {
  allMeetings = await chrome.runtime.sendMessage({ type: 'GET_MEETINGS' }) || [];
  render(getVisible());
  updateCount();
  updateToggle();

  document.getElementById('search-input').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) { render(getVisible()); return; }
    render(getVisible().filter(m =>
      (m.title || '').toLowerCase().includes(q) ||
      (m.meetingId || '').toLowerCase().includes(q) ||
      (m.participants || []).some(p => p.toLowerCase().includes(q))
    ));
  });

  document.getElementById('toggle-empty').addEventListener('click', () => {
    hideEmpty = !hideEmpty;
    updateToggle();
    render(getVisible());
  });

  document.getElementById('nav-settings').addEventListener('click', () => {
    chrome.tabs.create({ url: '../settings/settings.html' });
  });

  document.getElementById('export-all-btn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(null);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meetscribe-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.meetingIndex) {
      allMeetings = changes.meetingIndex.newValue || [];
      render(getVisible());
      updateCount();
      updateToggle();
    }
  });
});

function updateCount() {
  document.getElementById('meeting-count').textContent = allMeetings.length;
}

function updateToggle() {
  const btn = document.getElementById('toggle-empty');
  if (!btn) return;
  const emptyCount = allMeetings.filter(m => !m.entryCount || m.entryCount === 0).length;
  btn.textContent = hideEmpty ? `Show empty (${emptyCount})` : 'Hide empty';
  btn.style.display = emptyCount > 0 ? '' : 'none';
}

function render(meetings) {
  const grid = document.getElementById('meetings-grid');

  if (!meetings || meetings.length === 0) {
    const msg = hideEmpty && allMeetings.length > 0
      ? 'All meetings are empty (no captions captured).'
      : 'Join a Google Meet call and start capturing.';
    grid.innerHTML = `
      <div class="empty">
        <p class="empty-title">No meetings to show</p>
        <p class="empty-hint">${msg}</p>
      </div>`;
    return;
  }

  grid.innerHTML = meetings.map(cardHtml).join('');

  grid.querySelectorAll('.card').forEach(card => {
    const key = card.dataset.key;
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openTranscript(key);
    });
  });

  grid.querySelectorAll('.act-view').forEach(b =>
    b.addEventListener('click', () => openTranscript(b.dataset.key)));

  grid.querySelectorAll('.act-export').forEach(b =>
    b.addEventListener('click', () =>
      chrome.runtime.sendMessage({ type: 'EXPORT_TRANSCRIPT', payload: { meetingKey: b.dataset.key, format: 'md' } })));

  grid.querySelectorAll('.act-delete').forEach(b =>
    b.addEventListener('click', async () => {
      if (confirm('Delete this transcript?'))
        await chrome.runtime.sendMessage({ type: 'DELETE_MEETING', payload: { meetingKey: b.dataset.key } });
    }));
}

function cardHtml(m) {
  const date = fmtDate(m.startTime);
  const dur = m.durationMinutes || '?';
  const entries = m.entryCount || 0;
  const parts = (m.participants || []).join(', ') || '';

  return `
    <div class="card" data-key="${ea(m.key)}">
      <div class="card-title">${eh(m.title || m.meetingId)}</div>
      <div class="card-meta">
        <span>${date}</span>
        <span>${dur} min</span>
        <span>${entries} entries</span>
      </div>
      ${parts ? `<div class="card-participants">${eh(parts)}</div>` : ''}
      <div class="card-badges">
        ${m.hasSummary ? '<span class="badge badge-accent">Summary</span>' : ''}
        ${m.captureStatus === 'partial' ? '<span class="badge badge-warning">Partial</span>' : ''}
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm act-view" data-key="${ea(m.key)}">View</button>
        <button class="btn btn-secondary btn-sm act-export" data-key="${ea(m.key)}">Export</button>
        <button class="btn btn-danger btn-sm act-delete" data-key="${ea(m.key)}">Delete</button>
      </div>
    </div>`;
}

function openTranscript(key) {
  chrome.tabs.create({ url: `../transcript/viewer.html?key=${encodeURIComponent(key)}` });
}

function fmtDate(s) {
  if (!s) return 'Unknown';
  return new Date(s).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function eh(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function ea(s) { return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
