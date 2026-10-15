# Corum Startup Animation — Remotion

Remotion project that renders the Corum desktop **启动动画视频** (`type: 'video'`
startup theme): a 3D first-person star/code tunnel → code fragments converge →
the **"Corum Harness"** title → a ready state with tagline + progress bar + 就绪.

Output: **`../assets/startup-animation.mp4`** — 1920×1080, 30 fps, 8 s, H.264 +
AAC. This is exactly the file the Corum startup video-theme player serves over
Range requests (see `../startup-theme-kit/` and `../startup-theme-kit/README.md`).

## Structure

```
startup-theme-remotion/
  package.json            # Remotion + @remotion/three + three + react 18
  tsconfig.json
  remotion.config.ts      # codec/quality + WebGL angle-egl renderer flag
  src/
    index.ts              # registerRoot() entry
    Root.tsx              # <Composition id="CorumStartup" 240f@30fps 1920×1080>
    StartupAnimation.tsx  # 3D scene + phase-3 HTML overlays + <Audio>
    CodeParticles.tsx     # code-token Points + atlas shader (tunnel + converge)
    StarField.tsx         # distant drifting star background (parallax depth)
    TextConverge.tsx      # "Corum Harness" canvas-texture plane (fade-in + glow)
    audio.ts              # arpeggio config (C4→E4→G4→C5, start frame 180)
  generate-audio.mjs      # pure-JS synth → public/arpeggio.wav (no native deps)
  render.mjs              # ensure audio + `npx remotion render` → ../assets/*.mp4
  public/
    arpeggio.wav          # generated (run generate-audio.mjs or render.mjs)
```

## Quick start

```bash
cd packages/desktop/startup-theme-remotion

# 1. install (isolated from the workspace — uses its own React/three)
pnpm install --ignore-workspace

# 2. preview in the Remotion Studio (live timeline scrub)
pnpm preview        # → http://localhost:3000

# 3. render the final MP4 to ../assets/startup-animation.mp4
pnpm render         # = node render.mjs  (regenerates audio if missing)

# or: render everything (audio + video) in one go
pnpm render:full
```

## Timeline (30 fps × 8 s = 240 frames)

| Phase | Frames | Time | What happens |
|-------|--------|------|--------------|
| 1 星际穿梭 | 0–120 | 0s–4s | code-token Points fly down z-axis toward the camera; near=b big+fast, far=small+slow; recycled past the lens. StarField drifts slower behind for parallax. |
| 2 汇聚过渡 | 120–180 | 4s–6s | particles ease-converge to screen center (x,y→0, z→-10) and fade out (1→0); the "Corum Harness" canvas-texture plane fades in (0→1) with a purple backlight. |
| 3 就绪展示 | 180–240 | 6s–8s | title holds; tagline "立矩成道 · Agent 成团开发" (cyan #01CDFE) + progress bar (purple→light-purple, fills 0→1) + "就 绪 · READY" label fade in; ascending arpeggio C4→E4→G4→C5 plays. |

## Key implementation points

### 1. 3D code particles (`CodeParticles.tsx`)
- Each particle is a **real code token** from the Corum vocabulary (~90 words).
- A single **atlas texture** (`buildAtlasTexture`) rasterizes every word × every
  palette color into one canvas (cols=words, rows=colors). A custom
  `ShaderMaterial` (Points) samples the correct atlas cell per particle via
  `aCellU/aCellV` attributes → one draw call for all 140 particles.
- `gl_PointSize` scales with `1/(-mv.z)` so nearer particles are bigger (true
  perspective "近大远小"). z drift is a pure function of `frame` (wrapped), so
  every render of a given frame is identical (idiomatic Remotion).
- Phase 2: `converge` (0→1, inOut-cubic) lerps x,y→0 and z→-10; `fade` (1→0)
  drives `aOpacity`.

### 2. Text convergence (`TextConverge.tsx`)
- "Corum Harness" is rasterized once onto a `CanvasTexture` (white text + radial
  purple glow + shadow blur), mapped on a Three.js `planeGeometry` near the
  camera (z=-8) so it composites inside the same 3D scene.
- Material `opacity` eased 0→1 across frames 120–168 (out-cubic); scale 0.92→1.
  A `pointLight` (#B98CFF) sits behind the plane as the convergence light source.

### 3. Audio (`audio.ts` + `generate-audio.mjs`)
- `generate-audio.mjs` is **pure JS, no native audio deps**: it synthesizes the
  C4→E4→G4→C5 arpeggio with an ADSR envelope + 2nd/3rd harmonics into a 16-bit
  PCM mono WAV at `public/arpeggio.wav`.
- `StartupAnimation.tsx` plays it via Remotion's `<Audio src={staticFile(...)}>`
  wrapped in a `<Sequence from={180}>` so it starts at 6 s.
- Re-running `node generate-audio.mjs` regenerates it deterministically.

## Rendering gotchas (solved — recorded so re-renders work first try)

1. **Sub-project must install with `--ignore-workspace`**: this directory is
   *not* in `pnpm-workspace.yaml`'s `packages` glob (it lives under
   `packages/desktop`, not `packages/desktop/*`), so it carries its own pinned
   React 18 / three / Remotion tree without polluting the corum build.
2. **`@react-three/fiber` must be pinned to `8.x`** (we use `8.17.10`).
   `@remotion/three`'s peer is `>=8.0.0`, but pnpm resolves that to fiber 9.x,
   which requires React 19 and crashes on React 18 (`Cannot read properties of
   undefined (reading 'S')`). The 8.x pin keeps the React-18 reconciler.
3. **WebGL needs `angle-egl`** in headless Chrome. Without
   `Config.setChromiumOpenGlRenderer('angle-egl')`, chrome-headless-shell fails
   to create a WebGL context ("BindToCurrentSequence failed"). Already set in
   `remotion.config.ts`.
4. **chrome-headless-shell download**: `npx remotion browser ensure` downloads
   it to `node_modules/.remotion/chrome-headless-shell/...`. On macOS arm64 the
   zip extracts to `chrome-headless-shell-mac-arm64/chrome-headless-shell`.
   If a download is interrupted, delete `node_modules/.remotion` and re-run
   `npx remotion browser ensure` (Remotion skips re-extract if the folder
   exists, even when the binary is missing).
5. **fps/width/height are on `<Composition>`**, not on `Config` — Remotion's
   source of truth for a render is the composition declaration in `Root.tsx`.

## Using the MP4 as a startup theme

The render output path (`../assets/startup-animation.mp4`) is the ship
location. To ship it as an importable video theme, copy it into the
`startup-theme-kit/video/content/` template and adjust `manifest.json`'s `entry`
(see `../startup-theme-kit/README.md` "视频与结束规则"). The player supports
MP4/WebM, default muted, no loop, preserves aspect, Range requests.
