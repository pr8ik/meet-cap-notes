# MeetScribe — Project Documentation

## What This Is
Chrome extension (Manifest V3) that captures Google Meet captions in real-time and saves them as searchable transcripts. 100% on-device. Optional AI summaries via Claude API.

## Architecture

```
meetscribe/
├── manifest.json              # MV3 manifest
├── content-script.js          # Caption capture engine (injected into Meet pages)
├── content-style.css          # Banner + status widget styles
├── service-worker.js          # Storage, badges, Claude API proxy, exports, notifications
├── design-system.css          # Shared CSS variables, typography, components
├── selectors.js               # Reference selector file (not loaded at runtime)
├── popup/                     # Extension popup (meeting list, status)
├── transcript/                # Full-page transcript viewer + AI summary
├── dashboard/                 # Full-page meeting list with search/filter
├── settings/                  # Settings page (accordion sections)
└── assets/                    # Extension icons (16/48/128px)
```

## Caption Detection (CRITICAL)

Google Meet does **NOT** use `aria-live` for captions (contrary to most online guides). The actual DOM structure (verified April 2026):

```
.a4cQT              ← caption region container
  └─ .nMcdL         ← per-speaker caption block
       ├─ .adE6rb   ← speaker info wrapper
       │    ├─ IMG.Z6byG    ← avatar
       │    └─ .KcIKyf > SPAN.NWpY1d  ← speaker name
       └─ .VbkSUe   ← caption text
```

### Key selectors (fragile — Google changes these)
- `.a4cQT` — caption region (primary target for MutationObserver)
- `.nMcdL` / `.bj4p3b` — individual caption blocks
- `.NWpY1d` / `.KcIKyf` — speaker name
- `.VbkSUe` — caption text content
- `[jsname="dsyhDe"]` — jsname-based fallback

### Three extraction strategies (cascade):
1. **Class-based**: `.nMcdL` → `.NWpY1d` (speaker) + `.VbkSUe` (text)
2. **Structural walk**: Navigate child divs heuristically
3. **Text diff**: Snapshot region text every 2s, diff for new content

### System message filter
Expanded regex filters: join/leave messages, device names (Microphone, Speakers, Webcam), countdown timers, call status messages.

## Waiting Room vs Meeting Detection
- `checkInMeeting()` — looks for leave/end call button
- `checkInWaitingRoom()` — looks for join/ask-to-join button
- Capture request in waiting room enters "pending" state
- Real observation starts only when leave button appears

## Storage Schema
Each meeting stored in `chrome.storage.local` with key `meet_{id}_{date}T{time}`:
- `entries[]` — `{ speaker, text, timestamp, offsetSeconds }`
- `markers[]` — caption pause/resume events
- `aiSummary` — Claude-generated summary (nullable)
- Meeting index stored separately as `meetingIndex[]`

## Design System
- Warm amber accent (#e39b55 dark / #c07030 light)
- System fonts (-apple-system, BlinkMacSystemFont, "Segoe UI")
- Monospace for timestamps (SF Mono, Cascadia Code)
- Strict 4px spacing grid
- Dark and light themes via `[data-theme]` attribute

## Known Issues / Future Work

### HIGH PRIORITY
- **Selector fragility**: All `.a4cQT`, `.nMcdL`, `.VbkSUe` selectors WILL break when Google updates Meet. Need a selector health-check system that detects breakage and alerts the user. Consider adding a "selector update" mechanism or more structural/heuristic-based fallbacks that survive class name changes.
- **Tab proliferation**: Settings, dashboard, and transcript links open new tabs every time. Should use `chrome.tabs.query` to find existing tabs and focus them instead of creating new ones, or use a single-page architecture.

### MEDIUM PRIORITY
- Speaker colour coding needs to respect settings toggle
- Timestamp display toggle not yet wired to viewer
- Auto-capture for recurring meetings (meeting ID matching)
- Crash recovery (partial transcript salvage from last 30s flush)

### LOW PRIORITY
- Chrome Web Store publishing prep
- Storage usage indicator
- Transcript search within viewer
- Webhook/export integrations
