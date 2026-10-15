/**
 * Audio configuration for the Corum startup animation.
 *
 * Phase 3 (frames 180–240, 6s–8s) plays an ascending arpeggio:
 *   C4 → E4 → G4 → C5   (a bright major arpeggio that resolves upward).
 *
 * The audio is synthesized offline into a single WAV file by
 * `generate-audio.mjs` (pure JS, no native deps) and emitted to
 * `public/arpeggio.wav`. Remotion's `<Audio>` component imports that static
 * file via `staticFile('arpeggio.wav')`.
 *
 * Note frequencies (A4 = 440 Hz, equal temperament):
 *   C4 = 261.63,  E4 = 329.63,  G4 = 392.00,  C5 = 523.25
 */
export const SAMPLE_RATE = 44100;

export interface ArpNote {
  /** note name for readability */
  name: string;
  /** frequency in Hz */
  freq: number;
  /** start time in seconds (absolute, from clip start) */
  startSec: number;
  /** duration in seconds */
  durationSec: number;
}

/** Each note ~0.18s, slightly overlapping for a connected arpeggio feel. */
export const ARPEGGIO_NOTES: ArpNote[] = [
  { name: 'C4', freq: 261.63, startSec: 0.0, durationSec: 0.2 },
  { name: 'E4', freq: 329.63, startSec: 0.16, durationSec: 0.2 },
  { name: 'G4', freq: 392.0, startSec: 0.32, durationSec: 0.2 },
  { name: 'C5', freq: 523.25, startSec: 0.48, durationSec: 0.35 },
];

/** Total arpeggio clip length in seconds. */
export const ARPEGGIO_DURATION_SEC = 0.95;

/**
 * The arpeggio begins at frame 180 (6s) in the 8s composition. Remotion's
 * `<Audio>` uses `startFrom`/`endAt` in frames, so we precompute them here.
 */
export const ARPEGGIO_START_FRAME = 180;

/** Master volume (0..1) applied during synthesis. */
export const ARPEGGIO_VOLUME = 0.18;

/** Output path (relative to project root) for the synthesized WAV. */
export const ARPEGGIO_OUTPUT = 'public/arpeggio.wav';
