/**
 * Remotion configuration for the Corum startup animation.
 *
 * - 30 fps, 8s total = 240 frames  (declared on the <Composition> in Root.tsx)
 * - 16:9, 1920×1080  (declared on the <Composition>; the Corum startup window
 *   scales it down to fit while preserving aspect ratio)
 * - MP4 (H.264) for broad codec compatibility in the Electron/Chromium video
 *   theme player that supports Range requests.
 *
 * Note: fps / width / height are NOT settable here — they live on the
 * <Composition> component in Root.tsx (Remotion's source of truth for a render).
 */
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setConcurrency(null); // auto
Config.setPixelFormat('yuv420p');
Config.setCrf(18); // high quality, the file is rendered once and shipped

// @remotion/three (WebGL) needs a software OpenGL renderer in headless Chrome.
// Without this, the bundled chrome-headless-shell fails to create a WebGL
// context ("BindToCurrentSequence failed"). See https://www.remotion.dev/docs/three
Config.setChromiumOpenGlRenderer('angle-egl');

// keep the bundled entry small and deterministic
Config.setPublicDir('./public');
