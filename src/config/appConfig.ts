/**
 * App-wide configuration & values still pending confirmation from the client.
 * Centralised here so they can be swapped without touching screen logic.
 */

// TODO(#1): 실제 다운로드 용량 확정 후 교체. '[DATA_SIZE]' 자리.
export const DOWNLOAD_SIZE_MB = 42;

// Loading screen timing (Screen 1).
export const LOGO_FADE_MS = 800;
export const MODAL_DELAY_MS = 1500;

// Simulated download/loading durations until real asset sizes are wired up.
export const DOWNLOAD_DURATION_MS = 3000;
export const AR_LOADING_DURATION_MS = 2500;

// BIFAN brand palette (kept in sync with src/style.css custom properties).
export const COLORS = {
  bifanBlue: '#1A3A8F',
  darkButton: '#2C2C2C',
  guideRed: '#FF0000',
  guideGreen: '#00FF00',
  background: '#FFFFFF',
} as const;

// AR target recognition: how long the target must stay found before the
// prop animation auto-plays (Screen 5 → Screen 6).
export const TARGET_HOLD_MS = 3000;

// Feature flag: QR-recognition fallback (TODO #9, branch-only for now).
export const ENABLE_QR_FALLBACK = false;
