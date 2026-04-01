# MeetScribe — Product Requirements Document

**Version:** 1.0  
**Date:** 1 April 2026  
**Owner:** Pratik  
**Status:** Draft — Ready for Engineering  
**Product Type:** Chrome Extension (Manifest V3) — Personal Tool  

---

## 1. The Problem Worth Solving

### 1.1 Problem Statement

Google Meet generates accurate, real-time captions in dozens of languages — including mixed-language conversations and local dialects. This is arguably the most valuable raw data source in any meeting. Yet Google throws it away. The captions exist only as transient DOM elements that appear for a few seconds and vanish. There is no native way to save, search, or use this data.

Google's own "Notes by Gemini" meeting transcription exists, but it has three disqualifying limitations:

1. **Availability wall.** It requires Google Workspace (business) accounts. Paid personal Google accounts — including Google One AI Premium — do not get meeting transcription. This locks out freelancers, consultants, personal accounts, and anyone whose organisation hasn't enabled the feature.

2. **Language wall.** Gemini meeting notes work well in English. In multilingual meetings — where participants switch between English, Nepali, Hindi, or other languages mid-sentence — Gemini loses data. But Google Meet's *captions* capture these switches correctly in real time. The intelligence is generated and then discarded.

3. **Trust wall.** Third-party tools (Otter.ai, Tactiq, Fireflies) solve the transcription problem but introduce data security concerns. Meeting content routes through external servers. For organisations handling sensitive client data, this is unacceptable. For individuals, it's an unnecessary privacy risk for a problem that can be solved entirely client-side.

### 1.2 Root Cause Analysis

The root cause is not a missing technology. Google Meet already generates the data. The root cause is a **product decision** — Google locks transcription behind enterprise licensing to drive Workspace revenue, and its Gemini processing pipeline doesn't leverage the same multilingual capability that the caption system has.

This means the solution is architecturally simple: intercept what Google Meet already generates (captions), persist it locally, and add an intelligence layer on top.

### 1.3 Who Feels This Pain

**Primary user (v1):** Pratik — a tech leader who attends 5-10 meetings daily across multiple languages (English and Nepali), needs meeting records for accountability tracking, team management, and organisational intelligence. Currently works around this by manually inspecting the Google Meet caption DOM and cleaning up transcripts with AI — a process that takes 5-10 minutes per meeting and only happens for the most important calls.

**Latent audience (v2+):** Anyone on a personal Google account, anyone in multilingual meetings, anyone who values data sovereignty over convenience, and any privacy-conscious professional who won't trust third-party transcription services.

### 1.4 What's Lost Without This

Applying loss aversion framing: every meeting without this tool is **data permanently destroyed**. Decisions, commitments, context, the exact words someone used — gone. The cost isn't the $10/month a transcription tool charges. The cost is the meetings you can't search, the commitments you can't verify, the patterns across meetings you can't see.

---

## 2. Product Vision and Principles

### 2.1 Vision

**MeetScribe turns Google Meet's disposable captions into a permanent, searchable, intelligent meeting record — entirely on-device, in any language Google Meet can caption.**

### 2.2 Design Principles

These principles resolve design conflicts. When two good ideas compete, the principle higher on this list wins.

| # | Principle | What It Means | What It Kills |
|---|-----------|---------------|---------------|
| 1 | **Invisible during the meeting** | The tool must never distract from the conversation. No floating panels, no live transcript overlays, no UI that competes with Meet. The user's attention belongs to the people in the call, not the tool. | Kill: live transcript sidebar, real-time word count, "AI is listening" indicators during the call |
| 2 | **Zero-config capture** | Once set up, the tool should capture with minimal user action. One click to start. Auto-detect meetings. Default to capturing. | Kill: per-meeting configuration wizards, language selection prompts every time, multi-step start flows |
| 3 | **Data never leaves the device** | All transcript data stays in the browser. No external servers, no telemetry, no analytics. The only external call is the optional Claude API summarisation, which the user explicitly triggers with their own API key. | Kill: cloud sync, analytics dashboards, "share transcript" features that route through a server |
| 4 | **Intelligence on demand, not by default** | Raw transcript is always saved. AI summary is a deliberate action the user takes after the meeting, not an automatic process that burns API tokens on every standup. | Kill: auto-summarise on meeting end, always-on AI processing, background API calls |
| 5 | **Graceful degradation** | If selectors break (Google changes the DOM), the tool should fail visibly and cleanly — not silently lose data. A clear "captions not detected" warning is better than an empty transcript the user discovers hours later. | Kill: silent failures, generic error messages, "something went wrong" without actionable guidance |

### 2.3 Product Name

**MeetScribe** — simple, descriptive, memorable. Communicates what it does without overreaching. The "Scribe" metaphor frames it correctly: a scribe records faithfully; they don't interpret, filter, or editorialize. The AI summary is a separate, deliberate act.

---

## 3. User Experience Design

### 3.1 The Experience Arc

A meeting has five psychological phases. MeetScribe's UX maps to each:

```
PRE-MEETING          JOINING           DURING            ENDING           POST-MEETING
(anticipation)      (setup)          (flow state)      (transition)     (reflection)
                                                        
User's mind:        User's mind:     User's mind:      User's mind:     User's mind:
"What's this        "Let me get      "I'm focused      "What did we     "I need to
meeting about?"     set up"          on the people"    decide?"         remember this"
                                                        
MeetScribe:         MeetScribe:      MeetScribe:       MeetScribe:      MeetScribe:
[dormant]           [one prompt]     [invisible]       [auto-save]      [the payoff]
```

The critical insight: **MeetScribe's value is delivered POST-meeting, but its work happens DURING the meeting.** The UX challenge is making the "during" phase completely invisible so the user forgets the tool exists, and making the "post" phase deliver a moment of delight when a clean transcript appears.

### 3.2 Detailed User Flow

#### Phase 1: First-Time Setup (one-time, ~2 minutes)

1. User installs extension from Chrome Web Store (or loads unpacked for personal use)
2. Extension icon appears in Chrome toolbar — neutral grey state
3. User clicks icon → sees a clean welcome screen:
   - Brief explanation: "MeetScribe captures Google Meet captions as a transcript. All data stays on your device."
   - Single configuration option: Claude API key input (optional, for AI summaries)
   - Toggle: "Auto-prompt when joining Google Meet" (default: ON)
   - "Done" button
4. Setup complete. No account creation. No sign-in. No permissions beyond what manifest.json declares.

**UX rationale:** The Zeigarnik effect says people remember incomplete tasks. Don't make setup feel like an incomplete task with multiple steps and "you can configure more later" messaging. Make it feel complete in one screen.

#### Phase 2: Meeting Detection and Capture Prompt

1. User navigates to `meet.google.com/*` — the content script activates automatically
2. The extension icon shifts from grey to a subtle blue pulse — signalling awareness without demanding attention
3. A **non-modal notification banner** appears at the top of the Meet page (inside the page, not a browser popup):
   
   ```
   ┌─────────────────────────────────────────────────────────┐
   │  📝 MeetScribe ready.  [Start Capture]  [Skip]  [···]  │
   └─────────────────────────────────────────────────────────┘
   ```
   
   - The banner auto-dismisses after 8 seconds if no action is taken (default: skip)
   - The `[···]` menu contains: "Always capture on this recurring meeting" / "Never prompt for this meeting"
   - If the user previously selected "Always capture" for this meeting ID, skip the prompt entirely and begin capture with a brief toast: "📝 Capturing"

4. If user clicks **[Start Capture]**:
   - Banner transitions to: `📝 Capturing... (ensure captions are on)`
   - Extension checks if captions are active by looking for the caption container in DOM
   - If captions are NOT on: shows a one-line helper: `"Turn on captions: Click CC button or press C"`
   - After 10 seconds, if captions still not detected, banner shifts to amber: `"⚠️ No captions detected. Turn on captions to start recording."`
   - Once captions appear in DOM, banner shows green confirmation: `"✓ Recording"` then auto-dismisses after 3 seconds
   - Extension icon shows red "REC" badge for the duration of the meeting

**Influence principles at work:**
- **Default bias:** "Start Capture" is the visually prominent button (filled). "Skip" is secondary (outlined). The default leads toward capture.
- **Loss aversion:** The banner subtly communicates "your meeting data will be lost unless you act" without being manipulative — the tool is there, ready, just needs one click.
- **Commitment and consistency:** Once a user captures their first meeting, the pattern is set. Auto-capture for recurring meetings reduces the decision to zero.

#### Phase 3: During the Meeting (invisible)

The user sees **nothing from MeetScribe** during the meeting. No sidebar. No floating transcript. No word count. No "AI is analysing" indicator.

Behind the scenes:
- MutationObserver captures every caption element as it appears
- Speaker name + text + timestamp is extracted and buffered in memory
- Every 30 seconds, the buffer is flushed to `chrome.storage.local` via the service worker
- The extension icon badge stays on "REC" — the only visible indicator
- If caption DOM disappears (captions turned off), the badge shifts to "⏸" amber, and a single toast appears: `"Captions paused — turn them back on to continue capture"`

**Why no live transcript view?** Three reasons:
1. It splits the user's attention between reading and listening. You can't do both well.
2. It creates anxiety about accuracy ("did it get that right?") that undermines trust.
3. The post-meeting reveal is the "peak moment" (Peak-End Rule). Showing the transcript during the meeting deflates this.

#### Phase 4: Meeting End and Auto-Save

Meeting end is detected by one of three signals:
1. The "Leave call" / "End call" button click is intercepted
2. The URL changes away from `meet.google.com`  
3. The meeting DOM is destroyed (tab closed / navigated away)

On meeting end:
1. Final buffer flush — capture any remaining captions
2. Transcript compiled into structured format with metadata
3. Saved to `chrome.storage.local` with meeting ID as key
4. Extension icon badge changes to "✓" green for 5 seconds, then returns to neutral
5. A Chrome notification (not in-page — the page may be gone): 
   
   `"MeetScribe: Transcript saved — [Meeting Title] (47 min, 3 participants). Click to view."`

6. Clicking the notification opens the popup transcript viewer

**The save is non-negotiable and automatic.** There is no "save" button. There is no "are you sure?" dialog. If you were capturing, the transcript is saved. Period. Data loss is the only unforgivable failure mode.

#### Phase 5: Post-Meeting (the payoff)

User clicks the extension icon → popup opens to the **Transcript Viewer**:

```
┌──────────────────────────────────────────────────────┐
│  MeetScribe                                    [⚙️]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Latest Meeting                                      │
│  ─────────────────────────────────────────────       │
│  📋 Sprint Planning — Daily Standup                  │
│  🕐 1 Apr 2026, 10:00 AM — 10:47 AM (47 min)       │
│  👥 Pratik, Kam, Romy, Adishree                     │
│                                                      │
│  ┌────────────────────────────────────────────┐      │
│  │ [View Transcript]  [AI Summary]  [Export ▾]│      │
│  └────────────────────────────────────────────┘      │
│                                                      │
│  Previous Meetings                                   │
│  • Otto 1:1 (31 Mar, 42 min)                        │
│  • Tech Team Sync (31 Mar, 28 min)                  │
│  • Mortgage AI Review (30 Mar, 55 min)              │
│  • [View All →]                                      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**[View Transcript]** opens a clean, scrollable transcript in a new tab (full-page HTML rendered from stored data):

```markdown
# Sprint Planning — Daily Standup
**Date:** 1 April 2026, 10:00 AM — 10:47 AM  
**Participants:** Pratik, Kam, Romy, Adishree  
**Meeting ID:** abc-defg-hij  

---

**[10:00]** Pratik: Alright everyone, let's get started. Kam, can you go first?

**[10:01]** Kam: Sure. Yesterday I finished the n8n workflow for the loan 
assessment pipeline. Today I'm working on the error handling for edge cases 
where the lender API returns partial data.

**[10:02]** Pratik: What kind of edge cases are you seeing?

**[10:02]** Kam: Mostly timeouts and incomplete JSON responses. I've got three 
patterns identified, I'll document them in the Jira ticket.

**[10:03]** Romy: Quick question on that — does this affect the demo environment?
...
```

**[AI Summary]** triggers the Claude API call (requires API key configured):
- Shows a loading state: "Generating summary..."
- Sends the full transcript to Claude with a structured prompt
- Returns a summary in a standard format: Key Decisions, Action Items, Discussion Topics, Open Questions
- Summary is saved alongside the raw transcript
- Summary can be re-generated with a different prompt if needed

**[Export ▾]** dropdown:
- **Markdown (.md)** — default, includes metadata header and formatted transcript
- **Plain Text (.txt)** — simple, portable
- **JSON (.json)** — structured data for programmatic use
- **Copy to Clipboard** — for quick paste into notes apps

### 3.3 The "You" Problem

Google Meet labels the local user's captions as "You" instead of showing their actual name. This creates a transcript where every other person has a name except the user.

**Solution:** During first-time setup, ask: "What name should appear in transcripts for your own speech?" Default to the Google profile name if detectable from the Meet page. Store as a preference. Replace all "You" instances in saved transcripts with this name.

### 3.4 Edge Cases and Failure Modes

| Scenario | Expected Behaviour | User Communication |
|----------|-------------------|--------------------|
| Captions never turned on | Banner stays visible with helper text. No empty transcript saved. | Amber badge "⏸" + persistent helper |
| Captions turned off mid-meeting | Capture pauses. Transcript includes a `[Captions paused at 10:15]` marker. Resumes when captions return. | Toast: "Captions paused" + badge "⏸" |
| Tab closed unexpectedly | Last 30-second buffer flush is the recovery point. Partial transcript saved with `[Session ended unexpectedly]` marker. | Chrome notification on next browser launch: "Partial transcript recovered" |
| Very long meeting (3+ hours) | Memory buffer capped at 500 entries; older entries flushed to storage automatically. No degradation. | None — invisible |
| Multiple Meet tabs open | Each tab runs its own content script. Transcripts saved separately with distinct meeting IDs. | Badge shows on each tab independently |
| DOM selectors break (Google UI update) | Content script fails to find caption container. Capture does not start. | Clear error: "MeetScribe can't detect captions. This may be due to a Google Meet update. Check for extension updates." |
| No captions but "notes by gemini" active | MeetScribe detects no caption DOM elements. Does not attempt to capture Gemini notes. | Helper text prompts user to turn on captions |
| User joins late / leaves early | Capture starts from whenever captions become visible. Meeting metadata reflects actual capture window. | Metadata shows "Captured: 10:15–10:47 (32 of 47 minutes)" |
| Non-English or mixed-language captions | Captured exactly as Google Meet renders them. No language filtering. | None — this is a feature, not an edge case |
| Service worker dies during meeting | Content script continues capturing (it holds the buffer). Reconnects port on next flush cycle. | None — invisible recovery |

---

## 4. Functional Requirements

### 4.1 Requirement Priority Framework

Requirements are classified using MoSCoW with an additional "effort" indicator:

- **P0 (Must Have):** Ship-blocking. Without this, the product doesn't work.
- **P1 (Should Have):** Important for usability but can ship without for v1 personal use.
- **P2 (Could Have):** Enhances experience. Build if time allows.
- **P3 (Won't Have — v1):** Explicitly deferred. Documented for future reference.

### 4.2 Core Capture Engine

| ID | Requirement | Priority | Effort | Acceptance Criteria |
|----|------------|----------|--------|---------------------|
| CE-01 | Real-time caption capture via MutationObserver | P0 | Medium | Every caption element that appears in the DOM is captured within 500ms |
| CE-02 | Speaker name extraction from caption DOM | P0 | Medium | Speaker name correctly paired with their speech text for >95% of entries |
| CE-03 | Duplicate caption filtering | P0 | Low | Incremental text updates (word-by-word) consolidated into single entries. No duplicate lines in final transcript |
| CE-04 | Timestamp recording per caption entry | P0 | Low | Each entry has a wall-clock timestamp (local timezone) accurate to the second |
| CE-05 | "You" → user name replacement | P1 | Low | User configures display name once; all "You" entries show configured name |
| CE-06 | System message filtering | P0 | Low | Join/leave notifications, "recording started", and other system messages excluded from transcript |
| CE-07 | Caption pause/resume detection | P1 | Low | Transcript includes `[Captions paused]` / `[Captions resumed]` markers when captions are toggled off/on |
| CE-08 | Buffer flush every 30 seconds | P0 | Low | In-memory buffer writes to chrome.storage.local every 30 seconds during active capture |
| CE-09 | Crash recovery from last flush | P0 | Medium | If tab closes unexpectedly, partial transcript recoverable from storage on next session |
| CE-10 | Speaker segment merging | P1 | Medium | Consecutive captions from the same speaker within 3 seconds merged into a single paragraph |

### 4.3 Meeting Detection and Lifecycle

| ID | Requirement | Priority | Effort | Acceptance Criteria |
|----|------------|----------|--------|---------------------|
| ML-01 | Auto-detect Google Meet page load | P0 | Low | Content script activates on `meet.google.com/*` URLs |
| ML-02 | Display capture prompt banner | P0 | Medium | Non-modal banner appears within 2 seconds of meeting page load |
| ML-03 | Detect meeting end (leave/end button, URL change, tab close) | P0 | Medium | All three end signals trigger transcript finalisation |
| ML-04 | Extract meeting title from page DOM | P1 | Low | Meeting title populated if available; fallback to meeting code |
| ML-05 | Extract participant names from page | P1 | Medium | Participant list captured from DOM (avatar title attributes) at start and end of meeting |
| ML-06 | Calculate meeting duration from first to last caption timestamp | P0 | Low | Duration shown in metadata header |
| ML-07 | Auto-capture for recurring meetings | P2 | Medium | User can mark a meeting as "always capture"; skips prompt for that meeting ID |
| ML-08 | "Never prompt" for specific meetings | P2 | Low | User can suppress prompt for specific meeting IDs |

### 4.4 Storage and Persistence

| ID | Requirement | Priority | Effort | Acceptance Criteria |
|----|------------|----------|--------|---------------------|
| ST-01 | Store transcripts in chrome.storage.local | P0 | Low | Each meeting stored as a keyed JSON object |
| ST-02 | unlimitedStorage permission for large transcripts | P0 | Low | Manifest includes `unlimitedStorage`; no 10MB cap |
| ST-03 | Meeting list with metadata (title, date, duration, participants) | P0 | Medium | Popup displays chronological list of all stored meetings |
| ST-04 | Delete individual transcripts | P1 | Low | User can delete any single meeting record from storage |
| ST-05 | Storage usage indicator | P2 | Low | Settings shows approximate storage used |
| ST-06 | Export all data as single JSON backup | P2 | Medium | Full data export for portability |

### 4.5 Transcript Viewer

| ID | Requirement | Priority | Effort | Acceptance Criteria |
|----|------------|----------|--------|---------------------|
| TV-01 | Full-page transcript view in new tab | P0 | Medium | Clean, readable HTML page generated from stored data |
| TV-02 | Meeting metadata header (title, date, time, duration, participants) | P0 | Low | All available metadata displayed at top of transcript |
| TV-03 | Chronological speaker + timestamp + text layout | P0 | Low | Each entry shows `[HH:MM] Speaker: Text` clearly |
| TV-04 | Speaker colour coding | P1 | Medium | Each unique speaker gets a consistent colour for visual scanning |
| TV-05 | Search within transcript | P2 | Medium | Text search with highlighting across full transcript |
| TV-06 | Jump to timestamp | P2 | Medium | Click timestamp to scroll to that section |
| TV-07 | Copy full transcript to clipboard | P1 | Low | One-click copy of the entire formatted transcript |

### 4.6 Export

| ID | Requirement | Priority | Effort | Acceptance Criteria |
|----|------------|----------|--------|---------------------|
| EX-01 | Export as Markdown (.md) | P0 | Low | Metadata header + formatted transcript in clean markdown |
| EX-02 | Export as Plain Text (.txt) | P0 | Low | Simple text format with timestamps |
| EX-03 | Export as JSON (.json) | P1 | Low | Structured JSON with metadata and entries array |
| EX-04 | Copy to clipboard | P0 | Low | Formatted text copied for pasting into docs/notes |
| EX-05 | File download via chrome.downloads API | P0 | Low | Clean filename: `meetscribe-[title]-[date].md` |

### 4.7 AI Summary (Claude Integration)

| ID | Requirement | Priority | Effort | Acceptance Criteria |
|----|------------|----------|--------|---------------------|
| AI-01 | Claude API key configuration in settings | P0 | Low | User enters API key once; stored securely in chrome.storage.local |
| AI-02 | On-demand summary generation via button click | P0 | Medium | User explicitly triggers; no auto-summarisation |
| AI-03 | Structured summary output: Key Decisions, Action Items, Topics, Open Questions | P0 | Medium | Summary follows consistent format |
| AI-04 | Summary displayed below transcript | P0 | Low | Summary appears in the transcript view page |
| AI-05 | Summary saved alongside raw transcript | P0 | Low | Re-opening the transcript shows previously generated summary |
| AI-06 | Streaming response display | P1 | Medium | Summary streams in progressively as Claude generates it |
| AI-07 | Approximate token/cost display before generating | P2 | Low | "This transcript is ~8,000 tokens. Estimated cost: ~$0.03" |
| AI-08 | Re-generate with custom prompt | P2 | Medium | User can modify the summary prompt and re-run |
| AI-09 | Handle transcripts exceeding context window | P1 | High | Chunk long transcripts, summarise chunks, then synthesise |
| AI-10 | API call proxied through service worker | P0 | Low | Content script / popup never calls API directly |

### 4.8 Extension UI (Popup and Settings)

| ID | Requirement | Priority | Effort | Acceptance Criteria |
|----|------------|----------|--------|---------------------|
| UI-01 | Popup: current meeting status (recording/idle) | P0 | Low | Clear visual state indicator |
| UI-02 | Popup: recent meetings list (last 10) | P0 | Medium | Clickable list with title, date, duration |
| UI-03 | Popup: quick access to latest transcript | P0 | Low | One click to open last meeting's transcript |
| UI-04 | Settings: Claude API key input | P0 | Low | Masked input with save/clear |
| UI-05 | Settings: display name for "You" replacement | P1 | Low | Text input, saved to storage |
| UI-06 | Settings: auto-prompt toggle | P1 | Low | Enable/disable meeting detection prompt |
| UI-07 | Badge: "REC" during capture | P0 | Low | Red badge visible on extension icon |
| UI-08 | Badge: "⏸" when captions paused | P1 | Low | Amber badge visible on extension icon |
| UI-09 | Chrome notification on meeting end | P1 | Low | Notification with meeting title and duration |

---

## 5. Technical Architecture

### 5.1 Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Chrome Extension (MV3)                      │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────┐    │
│  │   Content Script      │  │   Service Worker             │    │
│  │   (meet.google.com)   │  │   (background.js)            │    │
│  │                       │  │                              │    │
│  │  • MutationObserver   │  │  • Message handler           │    │
│  │  • Caption extraction │  │  • Storage coordinator       │    │
│  │  • Buffer management  │  │  • Badge management          │    │
│  │  • Banner UI inject   │  │  • File export (downloads)   │    │
│  │  • Meeting metadata   │  │  • Claude API proxy          │    │
│  │  • Port keep-alive    │  │  • Chrome notifications      │    │
│  │                       │  │                              │    │
│  └──────────┬───────────┘  └──────────────┬───────────────┘    │
│             │    chrome.runtime             │                    │
│             │    .sendMessage /             │                    │
│             │    .connect (port)            │                    │
│             └──────────────────────────────┘                    │
│                           │                                     │
│                           │ chrome.storage.local                │
│                           │ (unlimitedStorage)                  │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────┐      │
│  │   Popup / Transcript Viewer                          │      │
│  │                                                      │      │
│  │  • Meeting list (reads storage)                      │      │
│  │  • Transcript renderer (new tab HTML)                │      │
│  │  • AI summary trigger + display                      │      │
│  │  • Export controls                                   │      │
│  │  • Settings management                               │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Data Schema

Each meeting record stored in `chrome.storage.local`:

```json
{
  "meet_abc-defg-hij_2026-04-01T10:00:00": {
    "version": 1,
    "meetingId": "abc-defg-hij",
    "title": "Sprint Planning — Daily Standup",
    "startTime": "2026-04-01T10:00:12+05:45",
    "endTime": "2026-04-01T10:47:33+05:45",
    "durationMinutes": 47,
    "participants": ["Pratik", "Kam", "Romy", "Adishree"],
    "captureStatus": "complete",
    "entries": [
      {
        "speaker": "Pratik",
        "text": "Alright everyone, let's get started. Kam, can you go first?",
        "timestamp": "2026-04-01T10:00:15+05:45",
        "offsetSeconds": 0
      },
      {
        "speaker": "Kam",
        "text": "Sure. Yesterday I finished the n8n workflow for the loan assessment pipeline.",
        "timestamp": "2026-04-01T10:01:03+05:45",
        "offsetSeconds": 48
      }
    ],
    "markers": [
      {
        "type": "captions_paused",
        "timestamp": "2026-04-01T10:23:00+05:45"
      },
      {
        "type": "captions_resumed",
        "timestamp": "2026-04-01T10:23:45+05:45"
      }
    ],
    "aiSummary": null,
    "exportHistory": [],
    "createdAt": "2026-04-01T10:47:33+05:45"
  }
}
```

### 5.3 Selector Resilience Strategy

All DOM selectors live in a single `selectors.js` constants file:

```javascript
export const SELECTORS = {
  // TIER 1: ARIA-based (most stable — accessibility mandated)
  captionContainer: '[aria-live="polite"]',
  leaveButton: 'button[aria-label*="Leave call"], button[aria-label*="End call"]',
  captionsToggle: 'button[aria-label*="caption" i], button[aria-label*="subtitle" i]',
  
  // TIER 2: Structural (moderately stable)
  participantImages: 'div[data-self-name] img[title], div.U04fid img[title]',
  
  // TIER 3: Class-based (fragile — expect breakage)
  speakerBadge: '.NWpY1d, .xoMHSc, .KcIKyf',
  captionText: '.bh44bd, .iTTPOb, .Mz6pEf',
  captionWrapper: '.iOzk7e, .TBMuR',
  meetingTitle: '[data-meeting-title], .u6vdEc, .roSPhc'
};

// Fallback extraction: if class selectors fail, walk the DOM tree
// structurally. The caption container (aria-live) will always have
// child divs with text content. The first text node is usually the
// speaker; subsequent text is the caption.
```

**When selectors break:** The extension logs a `SELECTOR_MISS` event to a local diagnostic counter. If more than 10 consecutive observations produce no results, the banner displays the "selectors may be outdated" warning. This makes the failure visible and actionable — the user knows to check for an update rather than silently getting empty transcripts.

### 5.4 Claude API Integration

The summary prompt is engineered for meeting transcripts specifically:

```
You are analysing a meeting transcript. Provide a structured summary.

MEETING CONTEXT:
- Title: {title}
- Date: {date}
- Duration: {duration}
- Participants: {participants}

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
- If the transcript includes non-English content, preserve those segments 
  in the summary alongside any relevant translation or context.
- "Unknown Speaker" segments should be flagged if they contain action items.
- Keep the summary concise. A 1-hour meeting should produce ~300-500 words.

TRANSCRIPT:
{transcript}
```

API calls route through the service worker with streaming enabled. Estimated costs per meeting:

| Meeting Length | ~Token Count | Claude Sonnet Cost | Claude Haiku Cost |
|---------------|-------------|-------------------|-------------------|
| 15 min standup | ~3,000 | ~$0.01 | <$0.01 |
| 30 min sync | ~7,000 | ~$0.03 | ~$0.01 |
| 1 hour deep-dive | ~15,000 | ~$0.07 | ~$0.02 |
| 2 hour workshop | ~30,000 | ~$0.14 | ~$0.04 |

---

## 6. Success Metrics

Since this is a personal tool (v1), metrics are measured through self-reported experience and simple counters rather than analytics infrastructure.

### 6.1 Primary Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Transcript completeness** | >95% of spoken content captured vs. manual review | Compare 3 transcripts against manual listening |
| **Speaker accuracy** | >90% of entries correctly attributed | Manual spot-check of 5 meetings |
| **Zero data loss** | 0 meetings where capture was active but transcript is empty | Track over 20 meetings |
| **Time to transcript** | <3 seconds from meeting end to transcript availability | Stopwatch test |
| **Setup friction** | <2 minutes from install to first successful capture | Time the first-run experience |

### 6.2 Experience Metrics

| Metric | Target | How You'll Know |
|--------|--------|-----------------|
| **Meeting distraction** | Zero moments where MeetScribe pulls attention during a call | Self-awareness — if you ever look at MeetScribe during a meeting, the UX has failed |
| **Post-meeting utility** | Use the transcript or summary within 24 hours for >50% of meetings | Track which transcripts you actually open |
| **Trust** | Never second-guess whether it's recording | If you feel the need to check the badge repeatedly, confidence has failed |
| **AI summary usefulness** | Summary saves >5 minutes of manual note-taking per meeting | Compare to pre-MeetScribe note-taking time |

### 6.3 Technical Health Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Memory usage during capture** | <50MB additional for a 1-hour meeting | Chrome Task Manager during test meeting |
| **Storage per meeting** | <500KB for a 1-hour transcript | Check chrome.storage after 10 meetings |
| **Selector survival** | Selectors work for >30 days without update | Track `SELECTOR_MISS` counter |
| **Service worker recovery** | Zero transcript data lost to service worker termination | Test by forcing SW kill during capture |

---

## 7. Implementation Phases

### Phase 1: Core Capture Engine (MVP) — Target: 1-2 days

**Goal:** A working extension that captures Google Meet captions and saves them locally.

**Deliverables:**
- manifest.json with all required permissions
- Content script with MutationObserver caption capture
- Service worker with storage coordination
- Simple popup showing recording status and "view last transcript"
- Basic transcript view (new tab, formatted HTML)
- Markdown export

**What's NOT in Phase 1:**
- AI summary
- Settings UI
- Speaker colour coding
- Auto-capture for recurring meetings
- Crash recovery

**Definition of done:** Join a Google Meet call, enable captions, click Start Capture. Talk for 5 minutes. Leave meeting. Open transcript and see a readable, correctly attributed transcript.

### Phase 2: Polish and Intelligence — Target: 1-2 days

**Goal:** Add the AI layer and polish the experience into something you'd use every day.

**Deliverables:**
- Claude API integration (settings, summary generation, streaming)
- Settings page (API key, display name, auto-prompt toggle)
- Crash recovery (partial transcript salvage)
- Chrome notification on meeting end
- Speaker colour coding in transcript view
- Caption pause/resume markers
- All export formats (MD, TXT, JSON, clipboard)

**Definition of done:** Use MeetScribe for 5 real meetings across 2 days. All transcripts saved. AI summaries generated. No manual intervention needed during calls.

### Phase 3: Reliability and Edge Cases — Target: 1 day

**Goal:** Handle everything that goes wrong in real-world usage.

**Deliverables:**
- Selector fallback chain with diagnostic logging
- Long meeting handling (3+ hours)
- Multiple simultaneous Meet tabs
- Participant list extraction
- Meeting list management (delete, search)
- Storage usage indicator
- "Always capture" / "Never prompt" per meeting

**Definition of done:** Extension used for 2 full weeks (40+ meetings) without data loss, incorrect behaviour, or attention-breaking UX issues.

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Google changes caption DOM selectors | High (happens every 2-4 months) | High — capture breaks completely | Centralised selector file. ARIA-based primary selectors. Diagnostic counter triggers visible warning. Fast update cycle since personal tool. |
| Service worker terminated during long meeting | Medium | Low — content script holds buffer | Port keep-alive ping every 25s. Content script is the primary data holder, not the SW. 30-second flush cycle limits max data loss to 30 seconds. |
| Google Meet warns about extension access | High (known behaviour) | Low — cosmetic only | Extension doesn't modify Meet's functionality. Warning is about all extensions, not specific to MeetScribe. Users can dismiss. |
| Captions inaccurate for non-English speech | Medium | Medium — garbage in, garbage out | Explicitly framed as "captures what Google generates." Quality depends on Google's caption engine. Not our bug to fix. |
| Chrome storage quota issues over months of use | Low | Medium — can't save new transcripts | unlimitedStorage permission. Storage usage indicator in settings. Manual export + delete for archival. |
| Claude API key exposed in storage | Low (personal tool, local device) | Medium — API charges | Key stored in chrome.storage.local (sandboxed to extension). Not accessible to web pages. Acceptable for personal use. Production would need encryption. |
| Tab backgrounding throttles MutationObserver | Low | Medium — missed captions | Test extensively. Google Meet typically stays as active tab during calls. Content script execution is less affected than timers. |
| User forgets to turn on captions | Medium | High — no data captured | Persistent banner with helper text. Caption detection check on capture start. Amber badge if no captions detected after 10 seconds. |

---

## 9. What This Is Not (Explicit Non-Goals for v1)

These are things MeetScribe will **not** do in v1, and why:

| Non-Goal | Why Not |
|----------|---------|
| Record audio | Unnecessary complexity. Captions provide the text. Audio recording adds privacy concerns, storage overhead, and browser permission prompts. |
| Live transcription sidebar | Violates Principle #1 (invisible during meeting). Splits attention. |
| Cloud sync / backup | Violates Principle #3 (data never leaves device). Local-only for v1. |
| Multi-platform (Zoom, Teams) | Different DOM structures. Google Meet first, expand later. |
| Automatic caption activation | Would require simulating clicks on Meet UI, which is fragile and may trigger Google's extension detection. Manual "turn on captions" is one click for the user. |
| Chrome Web Store publishing | Personal tool. Side-loaded via developer mode. Avoids review process overhead. |
| Speaker diarisation from audio | Over-engineering. Google Meet's caption system already does speaker attribution via the DOM. |
| Real-time AI coaching | Out of scope. MeetScribe is a scribe, not a coach. |

---

## 10. Future Vision (v2+, Not Yet)

If MeetScribe proves useful in daily use, these become the natural extensions — but only after v1 is battle-tested:

1. **Transcript search across all meetings** — find "who said what about the API migration" across 50 meetings
2. **Meeting pattern analytics** — who talks most, which meetings produce action items, which are pure status updates
3. **Google Drive auto-export** — optional save to a Drive folder after each meeting
4. **Team deployment** — package for HLE/Alaya team use with shared configuration
5. **Zoom / Teams support** — extend caption capture to other platforms
6. **Organisational intelligence layer** — feed transcripts into a knowledge base for cross-meeting insights (aligns with the broader Alaya AI strategy)
7. **Webhook integration** — POST transcript to n8n or any automation endpoint

---

## 11. Open Questions

| Question | Needed For | Decision Deadline |
|----------|-----------|-------------------|
| Should the AI summary use Claude Sonnet or Haiku by default? | AI-02 | Before Phase 2. Trade-off: quality vs. cost. Recommendation: Haiku for standups, Sonnet for deep-dives. Let user choose. |
| What happens when Google ships caption history scrollback to all users? | CE-01 | Monitor. May change the capture approach from MutationObserver to periodic DOM scrape of history. |
| Should we attempt to auto-enable captions via keyboard shortcut injection (Shift+C)? | ML-02 | Before Phase 1. Risk: may trigger extension detection. Recommendation: start manual, test automation later. |
| Is there value in capturing chat messages alongside captions? | Future | v2 decision. Google Meet chat is a separate DOM region. Low effort to add but increases scope. |

---

## Appendix A: Competitive Landscape

| Tool | Approach | Limitation MeetScribe Solves |
|------|----------|------------------------------|
| Google Notes by Gemini | Server-side, Workspace only | Not available on personal accounts. Weak multilingual. |
| Tactiq | Chrome extension, freemium | Paid for AI features. Data goes to Tactiq servers. |
| Otter.ai | Bot joins meeting, records audio | Bot presence visible to all. Data on Otter servers. Paid. |
| Fireflies.ai | Bot joins meeting | Same as Otter. More expensive. |
| TranscripTonic (open source) | Chrome extension, caption scrape | Closest competitor. No AI summary. Less polished UX. Good reference implementation. |
| Manual DOM inspection | Copy-paste from inspect element | What Pratik does today. 5-10 minutes per meeting. Not scalable. |

**MeetScribe's positioning:** The only tool that combines (a) caption-based capture (works with all languages Google supports), (b) zero data exfiltration (100% on-device), (c) AI intelligence layer (Claude, user's own key), and (d) zero cost (no subscription, no freemium).

---

## Appendix B: Influence Principles Applied to UX Decisions

| UX Decision | Principle Applied | How |
|-------------|-------------------|-----|
| "Start Capture" as filled/primary button | Default Bias | The default visual weight guides toward capture |
| Auto-dismiss banner after 8 seconds | Satisficing | Don't make the user decide — if they don't act, skip gracefully |
| Post-meeting notification with stats | Peak-End Rule | The meeting memory ends with a positive confirmation moment |
| "You're losing data" framing in empty state | Loss Aversion | Empty meeting list says "Your meetings aren't being captured yet" not "Start capturing meetings" |
| One-click setup | Friction Reduction | Every additional setup step loses 20% of users (Fogg Behaviour Model) |
| Transcript appears instantly on meeting end | Reciprocity | The tool did the work during the meeting; the user receives the payoff immediately |
| "Always capture" option for recurring meetings | Commitment & Consistency | Once a user captures one instance of a recurring meeting, they'll want all of them |
| Speaker colours in transcript view | Cognitive Fluency | Colour coding reduces the mental effort of parsing who said what |

---

## Appendix C: File Structure

```
meetscribe/
├── manifest.json              # Extension manifest (MV3)
├── selectors.js               # ALL DOM selectors — single source of truth
├── content-script.js          # Caption capture engine + banner UI
├── service-worker.js          # Storage, badges, API proxy, exports
├── popup/
│   ├── popup.html             # Extension popup
│   ├── popup.js               # Popup logic (reads storage, triggers actions)
│   └── popup.css              # Popup styles
├── transcript/
│   ├── viewer.html            # Full-page transcript viewer template
│   ├── viewer.js              # Transcript rendering + AI summary
│   └── viewer.css             # Transcript viewer styles
├── settings/
│   ├── settings.html          # Settings page
│   ├── settings.js            # Settings logic
│   └── settings.css           # Settings styles
├── lib/
│   ├── storage.js             # Storage abstraction layer
│   ├── claude-api.js          # Claude API client
│   └── export.js              # Export format generators
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```
