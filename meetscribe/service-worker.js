// MeetScribe — Service Worker (Background)
// Handles: storage coordination, badge management, file exports, Claude API proxy, notifications.

// ─── State ───────────────────────────────────────────────────────────
let activeMeetings = new Map(); // meetingKey -> metadata

// ─── Keep-alive via port connections ─────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'recording-session') {
    port.onMessage.addListener((msg) => {
      // PING keep-alive — no action needed, just keeps SW alive
    });
  }
});

// ─── Message Handler ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'CAPTURE_STARTED':
      handleCaptureStarted(msg.payload);
      sendResponse({ ok: true });
      break;

    case 'FLUSH_BUFFER':
      handleFlushBuffer(msg.payload).then(() => sendResponse({ ok: true }));
      return true; // async

    case 'CAPTURE_STOPPED':
      handleCaptureStopped(msg.payload).then(() => sendResponse({ ok: true }));
      return true; // async

    case 'EXPORT_TRANSCRIPT':
      handleExport(msg.payload).then(() => sendResponse({ ok: true }));
      return true;

    case 'GENERATE_SUMMARY':
      handleGenerateSummary(msg.payload, sender).then(result => sendResponse(result));
      return true;

    case 'GET_MEETINGS':
      getMeetingsList().then(list => sendResponse(list));
      return true;

    case 'GET_TRANSCRIPT':
      getTranscript(msg.payload.meetingKey).then(data => sendResponse(data));
      return true;

    case 'DELETE_MEETING':
      deleteMeeting(msg.payload.meetingKey).then(() => sendResponse({ ok: true }));
      return true;

    case 'SAVE_SUMMARY':
      saveSummary(msg.payload.meetingKey, msg.payload.summary).then(() => sendResponse({ ok: true }));
      return true;
  }
});

// ─── Capture Lifecycle ───────────────────────────────────────────────
function handleCaptureStarted(payload) {
  activeMeetings.set(payload.meetingKey, {
    meetingId: payload.meetingId,
    title: payload.title,
    startTime: payload.startTime
  });

  // Set badge
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });

  // Store session state
  chrome.storage.session.set({
    isRecording: true,
    currentMeetingKey: payload.meetingKey,
    currentTitle: payload.title
  });

  // Initialize meeting record in storage
  chrome.storage.local.get([payload.meetingKey], (result) => {
    if (!result[payload.meetingKey]) {
      const record = {
        version: 1,
        meetingId: payload.meetingId,
        title: payload.title,
        startTime: payload.startTime,
        endTime: null,
        durationMinutes: null,
        participants: [],
        captureStatus: 'recording',
        entries: [],
        markers: [],
        aiSummary: null,
        exportHistory: [],
        createdAt: new Date().toISOString()
      };
      chrome.storage.local.set({ [payload.meetingKey]: record });
    }
  });
}

async function handleFlushBuffer(payload) {
  const { meetingKey, entries, metadata } = payload;

  return new Promise((resolve) => {
    chrome.storage.local.get([meetingKey], (result) => {
      const record = result[meetingKey];
      if (!record) {
        resolve();
        return;
      }

      // Apply "You" replacement
      chrome.storage.local.get(['settings'], (settingsResult) => {
        const settings = settingsResult.settings || {};
        const userName = settings.displayName || 'You';

        const processedEntries = entries.map(e => ({
          ...e,
          speaker: e.speaker === 'You' ? userName : e.speaker
        }));

        record.entries.push(...processedEntries);

        // Update metadata if available
        if (metadata.title && metadata.title !== record.meetingId) {
          record.title = metadata.title;
        }
        if (metadata.participants?.length > 0) {
          const allParticipants = new Set([...record.participants, ...metadata.participants]);
          record.participants = [...allParticipants];
        }

        chrome.storage.local.set({ [meetingKey]: record }, resolve);
      });
    });
  });
}

async function handleCaptureStopped(payload) {
  const { meetingKey, reason, endTime, title, participants } = payload;

  activeMeetings.delete(meetingKey);

  // Clear badge
  chrome.action.setBadgeText({ text: '' });

  // Clear session state
  chrome.storage.session.set({
    isRecording: false,
    currentMeetingKey: null,
    currentTitle: null
  });

  return new Promise((resolve) => {
    chrome.storage.local.get([meetingKey], (result) => {
      const record = result[meetingKey];
      if (!record) { resolve(); return; }

      record.endTime = endTime;
      record.captureStatus = reason === 'tab_closed' ? 'partial' : 'complete';

      if (title && title !== record.meetingId) record.title = title;
      if (participants?.length > 0) {
        const allP = new Set([...record.participants, ...participants]);
        record.participants = [...allP];
      }

      // Calculate duration
      if (record.startTime && record.endTime) {
        const durationMs = new Date(record.endTime) - new Date(record.startTime);
        record.durationMinutes = Math.round(durationMs / 60000);
      }

      // Update meeting index
      chrome.storage.local.get(['meetingIndex'], (indexResult) => {
        const index = indexResult.meetingIndex || [];
        const existing = index.find(m => m.key === meetingKey);
        const meta = {
          key: meetingKey,
          meetingId: record.meetingId,
          title: record.title,
          startTime: record.startTime,
          endTime: record.endTime,
          durationMinutes: record.durationMinutes,
          participants: record.participants,
          captureStatus: record.captureStatus,
          entryCount: record.entries.length,
          hasSummary: !!record.aiSummary
        };

        if (existing) {
          Object.assign(existing, meta);
        } else {
          index.unshift(meta);
        }

        chrome.storage.local.set({
          [meetingKey]: record,
          meetingIndex: index
        }, () => {
          // Show notification (check settings)
          chrome.storage.local.get(['settings'], (settingsResult) => {
            const settings = settingsResult.settings || {};
            if (settings.notifyOnEnd !== false) {
              chrome.notifications.create(meetingKey, {
                type: 'basic',
                iconUrl: 'assets/icon-128.png',
                title: 'MeetScribe: Transcript saved',
                message: `${record.title} (${record.durationMinutes || '?'} min, ${record.participants.length} participants, ${record.entries.length} entries). Click to view.`
              });
            }
            resolve();
          });
        });
      });
    });
  });
}

// ─── Meeting Data Access ─────────────────────────────────────────────
async function getMeetingsList() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['meetingIndex'], (result) => {
      resolve(result.meetingIndex || []);
    });
  });
}

async function getTranscript(meetingKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get([meetingKey], (result) => {
      resolve(result[meetingKey] || null);
    });
  });
}

async function deleteMeeting(meetingKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['meetingIndex'], (result) => {
      const index = (result.meetingIndex || []).filter(m => m.key !== meetingKey);
      chrome.storage.local.remove([meetingKey], () => {
        chrome.storage.local.set({ meetingIndex: index }, resolve);
      });
    });
  });
}

async function saveSummary(meetingKey, summary) {
  return new Promise((resolve) => {
    chrome.storage.local.get([meetingKey], (result) => {
      const record = result[meetingKey];
      if (!record) { resolve(); return; }
      record.aiSummary = summary;
      chrome.storage.local.set({ [meetingKey]: record }, () => {
        // Update index
        chrome.storage.local.get(['meetingIndex'], (indexResult) => {
          const index = indexResult.meetingIndex || [];
          const entry = index.find(m => m.key === meetingKey);
          if (entry) entry.hasSummary = true;
          chrome.storage.local.set({ meetingIndex: index }, resolve);
        });
      });
    });
  });
}

// ─── Export ──────────────────────────────────────────────────────────
async function handleExport(payload) {
  const { meetingKey, format } = payload;

  return new Promise((resolve) => {
    chrome.storage.local.get([meetingKey], (result) => {
      const data = result[meetingKey];
      if (!data) { resolve(); return; }

      let content, mimeType, extension;
      const dateStr = data.startTime ? new Date(data.startTime).toISOString().split('T')[0] : 'unknown';
      const safeTitle = (data.title || 'meeting').replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-');

      if (format === 'markdown' || format === 'md') {
        content = formatMarkdown(data);
        mimeType = 'text/markdown';
        extension = 'md';
      } else if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        mimeType = 'application/json';
        extension = 'json';
      } else {
        content = formatPlainText(data);
        mimeType = 'text/plain';
        extension = 'txt';
      }

      chrome.downloads.download({
        url: `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`,
        filename: `meetscribe-${safeTitle}-${dateStr}.${extension}`,
        saveAs: true
      });

      resolve();
    });
  });
}

function formatMarkdown(data) {
  const lines = [];
  lines.push(`# ${data.title || 'Meeting Transcript'}`);
  lines.push('');
  if (data.startTime) {
    const start = new Date(data.startTime);
    const end = data.endTime ? new Date(data.endTime) : null;
    lines.push(`**Date:** ${start.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
    lines.push(`**Time:** ${start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}${end ? ' — ' + end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : ''} (${data.durationMinutes || '?'} min)`);
  }
  if (data.participants?.length > 0) {
    lines.push(`**Participants:** ${data.participants.join(', ')}`);
  }
  lines.push(`**Meeting ID:** ${data.meetingId || 'unknown'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const entry of data.entries) {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    lines.push(`**[${time}]** ${entry.speaker}: ${entry.text}`);
    lines.push('');
  }

  if (data.aiSummary) {
    lines.push('---');
    lines.push('');
    lines.push('## AI Summary');
    lines.push('');
    lines.push(data.aiSummary);
  }

  return lines.join('\n');
}

function formatPlainText(data) {
  const lines = [];
  lines.push(data.title || 'Meeting Transcript');
  if (data.startTime) {
    const start = new Date(data.startTime);
    lines.push(`Date: ${start.toLocaleDateString()} ${start.toLocaleTimeString()}`);
  }
  if (data.participants?.length > 0) {
    lines.push(`Participants: ${data.participants.join(', ')}`);
  }
  lines.push('');

  for (const entry of data.entries) {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    lines.push(`[${time}] ${entry.speaker}: ${entry.text}`);
  }

  return lines.join('\n');
}

// ─── Claude API Integration ──────────────────────────────────────────
async function handleGenerateSummary(payload, sender) {
  const { meetingKey } = payload;

  const data = await getTranscript(meetingKey);
  if (!data) return { error: 'Transcript not found' };

  const settingsResult = await chrome.storage.local.get(['settings']);
  const settings = settingsResult.settings || {};
  const apiKey = settings.claudeApiKey;

  if (!apiKey) return { error: 'Claude API key not configured. Go to Settings to add your key.' };

  const transcript = data.entries
    .map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      return `[${time}] ${e.speaker}: ${e.text}`;
    })
    .join('\n');

  const model = settings.claudeModel || 'claude-sonnet-4-20250514';

  const prompt = `You are analysing a meeting transcript. Provide a structured summary.

MEETING CONTEXT:
- Title: ${data.title || 'Unknown'}
- Date: ${data.startTime ? new Date(data.startTime).toLocaleDateString() : 'Unknown'}
- Duration: ${data.durationMinutes || '?'} minutes
- Participants: ${data.participants?.join(', ') || 'Unknown'}

OUTPUT FORMAT:
## Summary
[2-3 sentence overview of what the meeting was about]

## Key Decisions
- [Decision made, including who made it]

## Action Items
- [ ] [Action] — Owner: [Name] — Deadline: [if mentioned]

## Discussion Topics
- [Topic]: [Brief summary of the discussion]

## Open Questions / Unresolved
- [Question or issue that wasn't resolved]

## Notable Quotes
- "[Exact quote]" — [Speaker] (include only if particularly significant)

INSTRUCTIONS:
- Be factual. Do not infer decisions that weren't explicitly stated.
- Attribute action items to specific people by name.
- If the transcript includes non-English content, preserve those segments in the summary alongside any relevant translation or context.
- "Unknown Speaker" segments should be flagged if they contain action items.
- Keep the summary concise. A 1-hour meeting should produce ~300-500 words.

TRANSCRIPT:
${transcript}`;

  // Keep service worker alive during API call
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 25000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { error: `API error (${response.status}): ${errorBody}` };
    }

    const result = await response.json();
    const summary = result.content?.[0]?.text || 'No summary generated.';

    // Save summary to storage
    await saveSummary(meetingKey, summary);

    return { summary };
  } catch (e) {
    return { error: `API call failed: ${e.message}` };
  } finally {
    clearInterval(keepAlive);
  }
}

// ─── Notification Click Handler ──────────────────────────────────────
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.create({
    url: `transcript/viewer.html?key=${encodeURIComponent(notificationId)}`
  });
  chrome.notifications.clear(notificationId);
});
