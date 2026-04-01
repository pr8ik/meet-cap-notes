// MeetScribe — Transcript Viewer

chrome.storage.local.get(['settings'], r => {
  document.documentElement.setAttribute('data-theme', r.settings?.theme || 'dark');
});

let meetingKey = null;
let meetingData = null;

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  meetingKey = params.get('key');

  if (!meetingKey) {
    document.getElementById('meeting-title').textContent = 'No transcript selected';
    return;
  }

  meetingData = await chrome.runtime.sendMessage({ type: 'GET_TRANSCRIPT', payload: { meetingKey } });

  if (!meetingData) {
    document.getElementById('meeting-title').textContent = 'Transcript not found';
    return;
  }

  renderHeader(meetingData);
  renderTranscript(meetingData);

  if (meetingData.aiSummary) {
    showSummary(meetingData.aiSummary);
  }

  const settings = await chrome.storage.local.get(['settings']);
  if (settings.settings?.claudeApiKey) {
    document.getElementById('summary-btn').disabled = false;
  }

  setupEventListeners();
});

function renderHeader(data) {
  document.getElementById('meeting-title').textContent = data.title || data.meetingId || 'Meeting';
  document.title = `MeetScribe \u2014 ${data.title || data.meetingId}`;

  const metaEl = document.getElementById('meeting-meta');
  const parts = [];

  if (data.startTime) {
    const start = new Date(data.startTime);
    const end = data.endTime ? new Date(data.endTime) : null;
    const dateStr = start.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    const endStr = end ? end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '';
    parts.push(`${dateStr}, ${timeStr}${endStr ? ' \u2013 ' + endStr : ''}`);
  }

  if (data.durationMinutes) parts.push(`${data.durationMinutes} min`);
  if (data.participants?.length > 0) parts.push(data.participants.join(', '));
  if (data.entries?.length > 0) parts.push(`${data.entries.length} entries`);

  metaEl.innerHTML = parts
    .map(p => `<span class="meta-item">${esc(p)}</span>`)
    .join('<span class="meta-sep">&middot;</span>');
}

function renderTranscript(data) {
  const container = document.getElementById('transcript');
  const speakerColors = {};
  let colorIndex = 0;

  function speakerClass(speaker) {
    if (!(speaker in speakerColors)) {
      speakerColors[speaker] = colorIndex % 8;
      colorIndex++;
    }
    return `speaker-${speakerColors[speaker]}`;
  }

  const items = [];

  for (const e of (data.entries || [])) {
    items.push({ type: 'entry', data: e, time: new Date(e.timestamp).getTime() });
  }
  for (const m of (data.markers || [])) {
    items.push({ type: 'marker', data: m, time: new Date(m.timestamp).getTime() });
  }
  items.sort((a, b) => a.time - b.time);

  let html = '';
  for (const item of items) {
    if (item.type === 'marker') {
      const t = fmtTime(item.data.timestamp);
      const label = item.data.type === 'captions_paused' ? 'Captions paused' : 'Captions resumed';
      html += `<div class="marker">[${t}] ${label}</div>`;
    } else {
      const e = item.data;
      html += `
        <div class="entry">
          <span class="entry-time">${fmtTime(e.timestamp)}</span>
          <span class="entry-speaker ${speakerClass(e.speaker)}">${esc(e.speaker)}</span>
          <span class="entry-text">${esc(e.text)}</span>
        </div>
      `;
    }
  }

  container.innerHTML = html || '<p style="color:var(--text-disabled); text-align:center; padding:var(--space-12) 0;">No transcript entries.</p>';
}

function showSummary(text) {
  const section = document.getElementById('summary-section');
  const content = document.getElementById('summary-content');

  // Better markdown → HTML: process line by line to avoid excessive <br>s
  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Blank line — close list if open, skip otherwise
    if (!trimmed) {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }

    // Heading
    if (trimmed.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      const heading = esc(trimmed.slice(3));
      html += `<h2>${applyInline(heading)}</h2>`;
      continue;
    }

    // List item
    if (trimmed.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      const item = esc(trimmed.slice(trimmed.startsWith('- [ ] ') ? 6 : 2));
      html += `<li>${applyInline(item)}</li>`;
      continue;
    }

    // Paragraph text
    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${applyInline(esc(trimmed))}</p>`;
  }

  if (inList) html += '</ul>';
  content.innerHTML = html;
  section.classList.remove('hidden');
  document.getElementById('summary-btn').textContent = 'Regenerate';
}

function applyInline(html) {
  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

async function generateSummary() {
  const loading = document.getElementById('summary-loading');
  const btn = document.getElementById('summary-btn');

  loading.classList.remove('hidden');
  btn.disabled = true;

  const result = await chrome.runtime.sendMessage({
    type: 'GENERATE_SUMMARY',
    payload: { meetingKey }
  });

  loading.classList.add('hidden');
  btn.disabled = false;

  if (result.error) { alert(result.error); return; }
  if (result.summary) showSummary(result.summary);
}

function setupEventListeners() {
  document.getElementById('summary-btn').addEventListener('click', generateSummary);
  document.getElementById('regenerate-btn')?.addEventListener('click', generateSummary);

  const exportBtn = document.getElementById('export-btn');
  const exportMenu = document.getElementById('export-menu');

  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('open');
  });

  document.addEventListener('click', () => exportMenu.classList.remove('open'));

  exportMenu.querySelectorAll('button[data-format]').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'EXPORT_TRANSCRIPT',
        payload: { meetingKey, format: btn.dataset.format }
      });
      exportMenu.classList.remove('open');
    });
  });

  document.getElementById('copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(formatText(meetingData)).then(() => {
      const b = document.getElementById('copy-btn');
      b.textContent = 'Copied!';
      setTimeout(() => { b.textContent = 'Copy to clipboard'; }, 2000);
    });
    exportMenu.classList.remove('open');
  });

  document.getElementById('delete-btn').addEventListener('click', async () => {
    if (confirm('Delete this transcript? This cannot be undone.')) {
      await chrome.runtime.sendMessage({ type: 'DELETE_MEETING', payload: { meetingKey } });
      window.close();
    }
  });
}

function formatText(d) {
  const lines = [d.title || 'Transcript'];
  if (d.startTime) {
    const s = new Date(d.startTime);
    lines.push(`Date: ${s.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
    const t = s.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    const e = d.endTime ? new Date(d.endTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '';
    lines.push(`Time: ${t}${e ? ' \u2013 ' + e : ''} (${d.durationMinutes || '?'} min)`);
  }
  if (d.participants?.length) lines.push(`Participants: ${d.participants.join(', ')}`);
  lines.push('');
  for (const e of (d.entries || [])) {
    lines.push(`[${fmtTime(e.timestamp)}] ${e.speaker}: ${e.text}`);
  }
  if (d.aiSummary) { lines.push('', '--- AI Summary ---', d.aiSummary); }
  return lines.join('\n');
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}
