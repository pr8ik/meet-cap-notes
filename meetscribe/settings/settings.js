// MeetScribe — Settings

document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get(['settings', 'meetingIndex']);
  const s = result.settings || {};
  const meetings = result.meetingIndex || [];

  // Populate
  document.getElementById('display-name').value = s.displayName || '';
  document.getElementById('theme').value = s.theme || 'dark';
  document.getElementById('auto-prompt').checked = s.autoPrompt !== false;
  document.getElementById('banner-dismiss').value = String(s.bannerDismissTime || 0);
  document.getElementById('notify-on-end').checked = s.notifyOnEnd !== false;
  document.getElementById('speaker-colours').checked = s.speakerColours !== false;
  document.getElementById('show-timestamps').checked = s.showTimestamps !== false;
  document.getElementById('default-export').value = s.defaultExport || 'md';
  document.getElementById('api-key').value = s.claudeApiKey || '';
  document.getElementById('claude-model').value = s.claudeModel || 'claude-sonnet-4-20250514';

  applyTheme(s.theme || 'dark');
  document.getElementById('meeting-count').textContent = meetings.length;
  estimateStorage();

  // Accordions
  document.querySelectorAll('.group-toggle').forEach(t => {
    t.addEventListener('click', () => {
      const body = document.getElementById(`section-${t.dataset.section}`);
      t.classList.toggle('open');
      body.classList.toggle('open');
    });
  });

  // Live theme preview
  document.getElementById('theme').addEventListener('change', e => applyTheme(e.target.value));

  document.getElementById('save-btn').addEventListener('click', saveSettings);

  document.getElementById('toggle-key').addEventListener('click', () => {
    const inp = document.getElementById('api-key');
    const btn = document.getElementById('toggle-key');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? 'Show' : 'Hide';
  });

  document.getElementById('export-all').addEventListener('click', exportAll);
  document.getElementById('clear-all').addEventListener('click', clearAll);
});

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

async function saveSettings() {
  const settings = {
    displayName: document.getElementById('display-name').value.trim(),
    theme: document.getElementById('theme').value,
    autoPrompt: document.getElementById('auto-prompt').checked,
    bannerDismissTime: parseInt(document.getElementById('banner-dismiss').value, 10),
    notifyOnEnd: document.getElementById('notify-on-end').checked,
    speakerColours: document.getElementById('speaker-colours').checked,
    showTimestamps: document.getElementById('show-timestamps').checked,
    defaultExport: document.getElementById('default-export').value,
    claudeApiKey: document.getElementById('api-key').value.trim(),
    claudeModel: document.getElementById('claude-model').value
  };
  await chrome.storage.local.set({ settings });
  const el = document.getElementById('save-status');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

async function estimateStorage() {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    document.getElementById('storage-size').textContent = `~${(est.usage / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    document.getElementById('storage-size').textContent = 'unknown';
  }
}

async function exportAll() {
  const data = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meetscribe-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearAll() {
  if (!confirm('Delete ALL transcripts and settings? This cannot be undone.')) return;
  if (!confirm('Are you absolutely sure?')) return;
  await chrome.storage.local.clear();
  document.getElementById('meeting-count').textContent = '0';
  document.getElementById('storage-size').textContent = '0 MB';
  document.getElementById('display-name').value = '';
  document.getElementById('api-key').value = '';
}
