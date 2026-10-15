/**
 * Generates public/arpeggio.wav — an ascending C4→E4→G4→C5 arpeggio for the
 * Corum startup animation's phase 3 (frames 180–240).
 *
 * Pure JS, no native audio deps. Produces a 16-bit PCM mono WAV.
 *
 * Run:  node generate-audio.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- note table (must mirror src/audio.ts) -----------------------------------
const SAMPLE_RATE = 44100;
const NOTES = [
  { name: 'C4', freq: 261.63, startSec: 0.0, durationSec: 0.2 },
  { name: 'E4', freq: 329.63, startSec: 0.16, durationSec: 0.2 },
  { name: 'G4', freq: 392.0, startSec: 0.32, durationSec: 0.2 },
  { name: 'C5', freq: 523.25, startSec: 0.48, durationSec: 0.35 },
];
const DURATION_SEC = 0.95;
const VOLUME = 0.18;

// --- helpers -----------------------------------------------------------------
/**
 * ADSR amplitude envelope. attack/decay/sustain/release as fractions of note
 * duration. Gives a soft pluck-ish tone rather than a raw sine buzz.
 */
function envelope(t, dur) {
  const a = 0.06, d = 0.18, s = 0.55, r = 0.22;
  const susLevel = 0.6;
  if (t < a) return (t / a) * 1.0;
  if (t < a + d) return 1.0 - ((t - a) / d) * (1.0 - susLevel);
  if (t < dur - r) return susLevel;
  if (t < dur) {
    const rt = (t - (dur - r)) / r;
    return susLevel * (1.0 - rt);
  }
  return 0;
}

/** A soft additive-synth voice: fundamental + 2nd + 3rd harmonics, decaying. */
function voice(phase) {
  const f0 = Math.sin(phase);
  const f1 = 0.35 * Math.sin(phase * 2);
  const f2 = 0.15 * Math.sin(phase * 3);
  return f0 + f1 + f2;
}

// --- render ------------------------------------------------------------------
const totalSamples = Math.floor(SAMPLE_RATE * DURATION_SEC);
const buffer = new Float32Array(totalSamples);

for (const note of NOTES) {
  const startSample = Math.floor(note.startSec * SAMPLE_RATE);
  const noteSamples = Math.floor(note.durationSec * SAMPLE_RATE);
  const phasePerSample = (2 * Math.PI * note.freq) / SAMPLE_RATE;
  let phase = 0;
  for (let i = 0; i < noteSamples; i++) {
    const outIndex = startSample + i;
    if (outIndex >= totalSamples) break;
    const t = i / noteSamples;
    const amp = envelope(i / noteSamples, 1) * VOLUME;
    buffer[outIndex] += amp * voice(phase);
    phase += phasePerSample;
  }
}

// gentle overall fade-out at the very end to avoid clicks
const tailSamples = Math.floor(SAMPLE_RATE * 0.05);
for (let i = 0; i < tailSamples; i++) {
  const outIndex = totalSamples - tailSamples + i;
  const k = 1 - i / tailSamples;
  buffer[outIndex] *= k;
}

// clamp + convert to 16-bit PCM
const pcm = new Int16Array(totalSamples);
for (let i = 0; i < totalSamples; i++) {
  let s = buffer[i];
  s = Math.max(-1, Math.min(1, s));
  pcm[i] = Math.round(s * 32767);
}

// --- WAV writer (16-bit PCM mono) -------------------------------------------
function writeWav(samples, sampleRate) {
  const byteLength = 44 + samples.length * 2;
  const buf = Buffer.alloc(byteLength);
  // RIFF header
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  // fmt chunk
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // subchunk1 size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  // data chunk
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buf;
}

const outPath = resolve(__dirname, 'public', 'arpeggio.wav');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, writeWav(pcm, SAMPLE_RATE));

console.log(`✓ arpeggio.wav written → ${outPath}`);
console.log(`  ${totalSamples} samples, ${(totalSamples / SAMPLE_RATE).toFixed(2)}s, ${(44 + pcm.length * 2)} bytes`);
