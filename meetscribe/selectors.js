// MeetScribe — DOM Selectors
// Single source of truth for all Google Meet DOM selectors.
// TIER 1: ARIA-based (most stable — accessibility mandated)
// TIER 2: Structural (moderately stable)
// TIER 3: Class-based (fragile — expect breakage every 2-4 months)

export const SELECTORS = {
  // TIER 1: ARIA-based
  captionContainer: '[aria-live="polite"]',
  leaveButton: 'button[aria-label*="Leave call"], button[aria-label*="End call"]',
  captionsToggle: 'button[aria-label*="caption" i], button[aria-label*="subtitle" i]',

  // TIER 2: Structural
  participantImages: 'div[data-self-name] img[title], div.U04fid img[title]',

  // TIER 3: Class-based (fragile)
  speakerBadge: '.NWpY1d, .xoMHSc, .KcIKyf',
  captionText: '.bh44bd, .iTTPOb, .Mz6pEf',
  captionWrapper: '.iOzk7e, .TBMuR',
  meetingTitle: '[data-meeting-title], .u6vdEc, .roSPhc'
};

// System messages to filter out of transcripts
export const SYSTEM_MESSAGE_PATTERN =
  /you left the meeting|return to home screen|leave call|feedback|audio and video|learn more|recording started|recording stopped|is presenting|you're the only one here|waiting for others|someone has joined|you've been admitted/i;

// Meeting URL pattern
export const MEETING_ID_PATTERN = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/;
