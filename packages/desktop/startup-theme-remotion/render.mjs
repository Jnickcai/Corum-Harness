/**
 * Renders the Corum startup animation to ../assets/startup-animation.mp4.
 *
 * Pipeline:
 *   1. ensure public/arpeggio.wav exists (run the audio synth if missing)
 *   2. npx remotion render CorumStartup ../assets/startup-animation.mp4
 *
 * Output: packages/desktop/assets/startup-animation.mp4  — exactly the file the
 * Corum startup video theme (type:'video', MP4 + Range) expects to ship.
 *
 * Run:  node render.mjs
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_ROOT = __dirname;
const OUTPUT_MP4 = resolve(PROJECT_ROOT, '..', 'assets', 'startup-animation.mp4');
const ARPEGGIO = resolve(PROJECT_ROOT, 'public', 'arpeggio.wav');

// --- step 1: ensure audio asset exists --------------------------------------
if (!existsSync(ARPEGGIO)) {
  console.log('→ public/arpeggio.wav missing, generating…');
  const r = spawnSync('node', ['generate-audio.mjs'], { cwd: PROJECT_ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('✖ audio generation failed (exit', r.status + ')');
    process.exit(typeof r.status === 'number' ? r.status : 1);
  }
} else {
  console.log('✓ public/arpeggio.wav present');
}

// --- ensure output dir exists ----------------------------------------------
import { mkdirSync } from 'node:fs';
mkdirSync(dirname(OUTPUT_MP4), { recursive: true });

// --- step 2: render ---------------------------------------------------------
// We shell out to the Remotion CLI so this script has no compile-time dep on
// @remotion/renderer internals (keeps it robust across Remotion patch versions).
const args = [
  'remotion',
  'render',
  'CorumStartup',
  OUTPUT_MP4,
  '--props={}',
  '--log=info',
];

console.log(`\n→ npx ${args.join(' ')}\n`);
const r = spawnSync('npx', args, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) {
  console.error('✖ remotion render failed (exit', r.status + ')');
  process.exit(typeof r.status === 'number' ? r.status : 1);
}

console.log(`\n✓ rendered → ${OUTPUT_MP4}`);
